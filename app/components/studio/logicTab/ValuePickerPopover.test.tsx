// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ValuePickerPopover } from "./ValuePickerPopover";
import { Answer } from "../../../lib/quizSchema";
import type { AttributeReadout } from "../../../lib/attributeClustering";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); });
it("stages a copied selection; Cancel writes nothing and Done preserves every unmanaged family", () => {
  const answer = Answer.parse({id:"a",text:"A",edge_handle_id:"h",tags:["keep"],collection_filters:["collection"],metafield_filters:[{key:"other",value:"preserve"}],variant_filters:[{name:"Size",value:"L"}],product_type_filters:["Board"]});
  const readout: AttributeReadout = {attributes:[{name:"Material",grade:"good",primary:{kind:"tag_family",key:"material"},members:[{kind:"tag_family",key:"material"}],values:[{value:"wood",count:1},{value:"metal",count:1},{value:"glass",count:1}],covered:3,distinctValues:3}],demoted:[],strongCount:1,strongNames:["Material"]};
  const onApply = vi.fn(); const host = document.createElement("div"); document.body.append(host); root=createRoot(host);
  act(() => root!.render(createElement(ValuePickerPopover,{trigger:createElement("button",null,"Choose"),answer,siblingAnswers:[answer],readout,productIndex:[],onApply})));
  const click=(text:string) => { const b=[...document.body.querySelectorAll("button")].find((b)=>b.textContent?.trim()===text); if(!b) throw new Error(text); act(()=>b.click()); };
  click("Choose");
  act(()=>document.querySelectorAll<HTMLButtonElement>(".qz-lw-vp-opt").forEach((b)=>b.click()));
  expect(onApply).not.toHaveBeenCalled(); expect(answer.tags).toEqual(["keep"]);
  click("Cancel"); expect(onApply).not.toHaveBeenCalled(); click("Choose");
  expect(document.querySelectorAll('.qz-lw-vp-opt[aria-pressed="true"]')).toHaveLength(0);
  act(()=>document.querySelector<HTMLButtonElement>(".qz-lw-vp-opt")!.click()); click("Done");
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply.mock.calls[0]![0]).toEqual({tags:["keep","material:wood"],collection_filters:["collection"],metafield_filters:[{key:"other",value:"preserve"}],variant_filters:[{name:"Size",value:"L"}],product_type_filters:["Board"]});
});
