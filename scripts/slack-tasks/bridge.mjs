import { readFile, writeFile, rename, mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import pino from 'pino';

const directory = join(homedir(), 'Library/Application Support/Wiskr Tasks');
const timestamp = z.string().regex(/^\d+\.\d+$/);
export const Task = z.object({
  id: z.string().regex(/^WIS-\d{3,}$/), title: z.string().min(1).max(1000),
  status: z.enum(['backlog', 'queued', 'building', 'review', 'done', 'blocked', 'human', 'cancelled']),
  priority: z.number().int().min(0).max(100),
  notes: z.string().max(10000),
  source: z.object({ channel: z.string(), ts: timestamp }).optional(),
  updatedAt: z.string().datetime(),
}).strict();
const State = z.object({
  version: z.number().int(), paused: z.boolean(), tasks: z.array(Task),
  handled: z.record(z.string()), boardTs: timestamp.optional(),
}).strict();
const Connection = z.object({
  token: z.string().startsWith('xoxb-'), teamId: z.string(), appId: z.string(),
  channels: z.array(z.string()).length(2), ownerId: z.string(),
});
const Message = z.object({
  ts: timestamp, text: z.string().optional(), user: z.string().optional(),
  bot_id: z.string().optional(), subtype: z.string().optional(),
  thread_ts: timestamp.optional(), reply_count: z.number().optional(),
  latest_reply: z.string().optional(), edited: z.object({ts: timestamp}).passthrough().optional(),
}).passthrough();
const log = pino({ level: 'info' }, pino.destination(2));
export const fingerprint = (message) => createHash('sha256').update(JSON.stringify({
  text: message.text, edited: message.edited,
})).digest('hex');
export function changes(messages, handled, channel, ownerId) {
  return messages.filter(m => (!m.subtype || m.subtype === 'thread_broadcast') &&
    m.user === ownerId && !m.bot_id && handled[`${channel}:${m.ts}`] !== fingerprint(m)
  ).map(m => ({key: `${channel}:${m.ts}`, fingerprint: fingerprint(m), message: m,
    channel, url: `https://app.slack.com/client/T0C0AE74RCH/${channel}/thread/${channel}-${m.thread_ts || m.ts}`}));
}
export function replaceTasks(state, request) {
  if (state.version !== request.version) throw new Error('State changed. Read state again before applying changes.');
  const tasks = request.tasks ?? state.tasks;
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) throw new Error('Duplicate task IDs');
  if (state.tasks.some(t => !tasks.some(next => next.id === t.id))) throw new Error('Retain tasks; use cancelled instead of deletion.');
  if (tasks.filter(t => t.status === 'building').length > 1) throw new Error('Only one task can build at once.');
  return State.parse({...state, tasks, paused: request.paused ?? state.paused,
    handled: {...state.handled, ...request.handled}, version: state.version + 1});
}
const escapeSlack = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function board(state) {
  const labels = {backlog:'Backlog (paused)', queued:'Queued', building:'Building', review:'Review', done:'Done', blocked:'Blocked', human:'Needs owner', cancelled:'Cancelled'};
  return `*Wiskr functionality backlog*\n${state.paused ? '⏸ Auto-start paused' : '▶ Auto-start enabled'} · checked about every 5 minutes while Codex is available\n\n` +
    [...state.tasks].sort((a,b) => a.priority-b.priority || a.id.localeCompare(b.id)).map(t =>
      `${t.status === 'done' ? '✓' : '•'} *${t.id}* · ${labels[t.status]} · ${escapeSlack(t.title)}${t.notes && t.status !== 'backlog' ? `\n    ${escapeSlack(t.notes)}` : ''}`
    ).join('\n') + '\n\nPost new requests in #functionality-requests. To change an item, post its WIS ID and the change in either channel. Only Tyler’s requests currently trigger work. Business/legal items stay assigned to the owner.';
}
async function atomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value,null,2)+'\n', {mode:0o600});
  await rename(tmp,file);
}
async function api(c, method, parameters={}) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method:'POST', headers:{Authorization:`Bearer ${c.token}`, 'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams(Object.entries(parameters).map(([k,v]) => [k,String(v)])),
    signal:AbortSignal.timeout(20000),
  });
  if (response.status === 429) throw new Error(`Slack rate limited; retry after ${response.headers.get('retry-after')} seconds.`);
  if (!response.ok) throw new Error(`Slack HTTP ${response.status}`);
  const result = z.object({ok:z.boolean(),error:z.string().optional()}).passthrough().parse(await response.json());
  if (!result.ok) throw new Error(`${method}: ${result.error || 'unknown error'}`);
  return result;
}
async function history(c, channel) {
  let cursor = ''; const messages=[];
  do {
    const result = z.object({messages:z.array(Message),response_metadata:z.object({next_cursor:z.string().optional()}).optional()})
      .parse(await api(c,'conversations.history',{channel,limit:100,cursor}));
    messages.push(...result.messages); cursor=result.response_metadata?.next_cursor || '';
  } while(cursor);
  return messages;
}
async function input() {let value=''; for await(const part of process.stdin) value+=part; return JSON.parse(value);}
async function main() {
  await mkdir(directory,{recursive:true,mode:0o700});
  const c=Connection.parse(JSON.parse(await readFile(join(directory,'connection.json'),'utf8')));
  const file=join(directory,'backlog.json');
  const command=process.argv[2];
  const state=State.parse(JSON.parse(await readFile(file,'utf8')));
  if(command === 'state') return state;
  if(command === 'poll') {
    const auth=await api(c,'auth.test');
    if(auth.team_id !== c.teamId) throw new Error('Slack workspace mismatch');
    const inbox=[]; const threads=[];
    for(const channel of c.channels) {
      const messages=await history(c,channel);
      inbox.push(...changes(messages,state.handled,channel,c.ownerId));
      // Bot tokens cannot reliably read public-channel thread replies. The worker
      // opens these in Slack using the signed-in browser; never silently omit them.
      threads.push(...messages.filter(m => (m.reply_count || 0)>0).map(m => ({
        channel,ts:m.ts,latestReply:m.latest_reply,replies:m.reply_count,
        url:`https://app.slack.com/client/${c.teamId}/${channel}/thread/${channel}-${m.ts}`,
      })));
    }
    return {inbox,threads,state};
  }
  if(command === 'post') {
    const request=z.object({channel:z.string(),text:z.string().min(1).max(35000),thread_ts:timestamp.optional()}).strict().parse(await input());
    if(!c.channels.includes(request.channel)) throw new Error('Channel is outside the task allowlist');
    const r=await api(c,'chat.postMessage',{...request,unfurl_links:false,unfurl_media:false,parse:'none'});
    return {ok:true,channel:r.channel,ts:r.ts};
  }
  if(command !== 'update' && command !== 'board') throw new Error('Use state, poll, update, post, or board. JSON input is read from stdin.');
  // Exclusive lock + optimistic version prevents overlapping workers losing edits.
  const lock=await open(join(directory,'backlog.lock'),'wx',0o600);
  try {
    const latest=State.parse(JSON.parse(await readFile(file,'utf8')));
    if(command === 'update') {
      const request=z.object({version:z.number().int(),tasks:z.array(Task).optional(),paused:z.boolean().optional(),handled:z.record(z.string()).optional()}).strict().parse(await input());
      const updated=replaceTasks(latest,request); await atomic(file,updated); return updated;
    }
    const text=board(latest);
    if(text.length>35000) throw new Error('Backlog exceeds one message; split the board before publishing.');
    const r=await api(c,latest.boardTs ? 'chat.update' : 'chat.postMessage',{
      channel:c.channels[0],text,...(latest.boardTs?{ts:latest.boardTs}:{}),unfurl_links:false,unfurl_media:false,
    });
    if(!latest.boardTs) await atomic(file,{...latest,boardTs:timestamp.parse(r.ts),version:latest.version+1});
    return {ok:true,channel:c.channels[0],ts:r.ts};
  } finally {await lock.close(); await unlink(join(directory,'backlog.lock'));}
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => console.log(JSON.stringify(result,null,2))).catch(error => {
    // Do not log request headers, connection data, or raw Slack responses.
    log.error({message:error instanceof z.ZodError ? 'Invalid data at boundary' : error.message},'Slack task bridge failed');
    process.exitCode=1;
  });
}
