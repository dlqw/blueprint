import { describe, expect, it } from "vitest";
import { viewportGridStyle } from "./GraphCanvas";

describe("viewportGridStyle", () => {
  it("scales grid steps from the active zoom", () => {
    expect(viewportGridStyle({ x: 0, y: 0, zoom: 1.5 })).toEqual({
      "--grid-minor-size": "36px 36px",
      "--grid-major-size": "180px 180px",
      "--grid-minor-position": "0px 0px",
      "--grid-major-position": "0px 0px"
    });
  });

  it("wraps positive and negative pan offsets into visible grid positions", () => {
    expect(viewportGridStyle({ x: -13, y: 49, zoom: 2 })).toEqual({
      "--grid-minor-size": "48px 48px",
      "--grid-major-size": "240px 240px",
      "--grid-minor-position": "35px 1px",
      "--grid-major-position": "227px 49px"
    });
  });
});
