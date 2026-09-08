// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Quiz } from "./quizSchema";
import { DEFAULT_TOKENS } from "./designTokens";
import { QuestionView } from "../components/runtime/views/QuestionView";
import { stylesFor } from "../components/runtime/runtimeStyles";
import { RuntimeChromeContext } from "../components/runtime/runtimeContexts";
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
it.each(["classic","minimal"] as const)("%s routing uses the first authored selected answer, not click order", (chrome) => {
  const doc=Quiz.parse({quiz_id:"route",scope:{collection_ids:[]},nodes:[{id:"q",type:"question",position:{x:0,y:0},data:{text:"Pick",question_type:"multi_select",answers:[{id:"a",text:"First",tags:[],edge_handle_id:"first"},{id:"b",text:"Second",tags:[],edge_handle_id:"second"}]}},{id:"end",type:"end",position:{x:0,y:1},data:{headline:"Done"}}],edges:[],results_pages:[]});
  const node=doc.nodes[0]; if(!node || node.type!=="question") throw new Error("fixture");
  const host=document.createElement("div"); document.body.append(host);const root=createRoot(host);const onAdvance=vi.fn();
  try {
    act(()=>root.render(createElement(RuntimeChromeContext.Provider,{value:chrome},createElement(QuestionView,{node,onAdvance,styles:stylesFor(DEFAULT_TOKENS),tokens:DEFAULT_TOKENS}))));
    const checks=host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    act(()=>checks[1]!.click());act(()=>checks[0]!.click());
    const next=[...host.querySelectorAll('button')].find((b)=>b.textContent?.includes('Next')); if(!next) throw new Error('Next missing'); act(()=>next.click());
    expect(onAdvance).toHaveBeenCalledWith(["b","a"],"first");
  } finally { act(()=>root.unmount());host.remove(); }
});
