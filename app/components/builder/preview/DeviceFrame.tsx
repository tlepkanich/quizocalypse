import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DEVICES, fitConstraint, fitScale, type DeviceTier } from "./previewWidth";

// Layout effects must not run during SSR (same alias runtimeStyles.ts uses).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type FrameFit = {
  scale: number;
  constrainedBy: "width" | "height" | "none";
  paneW: number;
  paneH: number;
};

/**
 * DeviceFrame — one of two FIXED browser viewports (previewWidth.DEVICES),
 * always shown whole, scaled down to fit the pane it is given.
 * Contract: GLOBAL-VIEWPORT.md — `viewport/2026-08`.
 *
 * There is no width prop and no drag handle: the device never changes size,
 * only the room it is shown in does. "Expand" is NOT a mode of this component —
 * the host renders the same <DeviceFrame> inside a window-sized overlay and the
 * identical fit rule produces the bigger result (never past 1:1).
 *
 * QRTZ-S3 (Quartz frames spec): the phone is BORDERLESS — a solid screen,
 * device radius (--qz-phone-r), soft elevation; no bezel, no notch, no
 * browser chrome, no bottom fade. The desktop tier is the 960×700 inline
 * embed band and keeps a hairline frame (.qz-devframe in the admin sheet).
 * The phone also draws the mock's "fold" marker: a dashed line 78px above
 * the bottom edge — where the 667px small-phone viewport (iPhone SE) cuts
 * the 745px frame. The scale/size readout lives in the host, fed by onFit.
 */
export function DeviceFrame({
  tier,
  children,
  placement,
  resetKey,
  zoom = 100,
  paneHeight = "100%",
  onFit,
}: {
  tier: DeviceTier;
  children: ReactNode;
  // Placement picks the CONTAINER INSIDE the viewport (the device toggle picks
  // the viewport itself): pop-up renders a modal envelope on a dark backdrop,
  // inline/product_widget a contained card on a neutral host page. Desktop tier
  // only; the phone viewport always shows the quiz page full-bleed.
  placement?: "page" | "popup" | "inline" | "product_widget";
  // "Scroll position resets when the previewed step changes, not on every
  // keystroke": the host passes the shown node's id.
  resetKey?: string | null;
  // C4 — zoom CLAMPS the fit scale, it does not multiply it. 100 means "as big
  // as fits" (the fit rule wins); 50 means "no bigger than half actual size".
  // Multiplying would compound with the fit scale and make the readout a lie on
  // any pane that is already scaling.
  zoom?: number;
  // The pane's height. Defaults to filling a definite-height host. A host whose
  // container is auto-height MUST pass a definite value or the height axis of
  // the fit rule measures 0 and the frame stops shrinking vertically.
  paneHeight?: number | string;
  // Reports the current fit so the host can render the size/scale readout.
  // Fired from an effect, never during render, and read through a ref so an
  // inline lambda from the host cannot loop.
  onFit?: (fit: FrameFit) => void;
}) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });

  useIsoLayoutEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => setPane({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = DEVICES[tier];
  const fit = fitScale(tier, pane.w, pane.h);
  const scale = Math.min(fit, zoom / 100);
  const constrainedBy = fitConstraint(tier, pane.w, pane.h);

  const onFitRef = useRef(onFit);
  useEffect(() => {
    onFitRef.current = onFit;
  });
  useEffect(() => {
    onFitRef.current?.({ scale, constrainedBy, paneW: pane.w, paneH: pane.h });
  }, [scale, constrainedBy, pane.w, pane.h]);

  // Reset the screen's scroll when the previewed step, tier or placement
  // changes — a switch never lands the merchant mid-page.
  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  }, [tier, placement, resetKey]);

  const isPopup = tier === "desktop" && placement === "popup";
  const isContained =
    tier === "desktop" && (placement === "inline" || placement === "product_widget");

  return (
    <div
      ref={paneRef}
      className={`qz-vp-pane qz-device-fit-${tier === "phone" ? "mobile" : "desktop"}`}
      style={{
        position: "relative",
        flex: "1 1 auto",
        width: "100%",
        height: paneHeight,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* The scaled FOOTPRINT. `transform` does not change layout size, so this
          slot carries the on-screen dimensions and the flex centring above
          stays honest at every scale — a 1128px frame in a 600px pane would
          otherwise overflow the start edge and become un-centrable. */}
      <div
        style={{
          position: "relative",
          flex: "0 0 auto",
          width: Math.round(w * scale),
          height: Math.round(h * scale),
        }}
      >
        <div
          className="qz-devframe"
          data-qz-tier={tier}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: w,
            height: h,
            // A2 — ALWAYS a transform, `scale(1)` and never undefined/none.
            // Together with `contain: paint` this makes the frame the
            // containing block for the runtime's position:fixed chip / scrim /
            // sheet AND clips them to the frame. Drop either and they anchor to
            // the merchant's browser window and float over the whole admin.
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            contain: "paint",
          }}
        >
          {/* Frame fixed, screen scrolls. The definite pixel height above is
              what lets the runtime's preview height chain (root height:100% →
              page min-height:100%) resolve instead of collapsing to 0. */}
          <div
            className="qz-devscreen"
            ref={screenRef}
            style={{
              width: "100%",
              height: "100%",
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
            }}
          >
            {isPopup ? (
              // Pop-up placement: an opaque stage behind a centered modal —
              // the container a shopper's window shows, inside our viewport.
              <div
                className="qz-dpop-backdrop"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  padding: 32,
                }}
              >
                <div
                  className="qz-dpop-modal"
                  style={{
                    width: "min(76%, 760px)",
                    maxWidth: "calc(100% - 64px)",
                    maxHeight: "calc(100% - 64px)",
                  }}
                >
                  {children}
                </div>
              </div>
            ) : isContained ? (
              // Inline / product widget: a contained card on a neutral page.
              <div style={{ padding: "40px 100px", minHeight: "100%" }}>
                <div className="qz-dinline-card">{children}</div>
              </div>
            ) : (
              children
            )}
          </div>
          {/* The mock's "fold" marker (_src/shared.mjs:660, base.mjs .fold):
              a dashed line 78px up — where the 667px small-phone viewport
              cuts this 745px frame. Phone tier only; never intercepts input. */}
          {tier === "phone" ? (
            <span className="qz-devfold" aria-hidden>
              fold
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
