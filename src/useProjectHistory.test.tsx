// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useProjectHistory } from "./useProjectHistory";
import { Project } from "./types";

function projectNamed(name: string): Project {
  return { name, path: "/p", numeros: [] };
}

function setup() {
  const onChange = vi.fn();
  const save = vi.fn();
  const onHistory = vi.fn();
  const hook = renderHook(() => {
    const ref = useRef(projectNamed("v0"));
    const h = useProjectHistory(ref, onChange, save, onHistory);
    return { ...h, ref };
  });
  return { hook, onChange, save, onHistory };
}

describe("useProjectHistory", () => {
  it("undoes and redoes an edit, saving each state", () => {
    const { hook, save } = setup();
    act(() => hook.result.current.update(projectNamed("v1")));
    expect(hook.result.current.history).toEqual({ undo: 1, redo: 0 });
    act(() => hook.result.current.undo());
    expect(hook.result.current.ref.current.name).toBe("v0");
    expect(hook.result.current.history).toEqual({ undo: 0, redo: 1 });
    act(() => hook.result.current.redo());
    expect(hook.result.current.ref.current.name).toBe("v1");
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("builds two quick updates on each other, ahead of the re-render", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.update(projectNamed("v1"));
      hook.result.current.update(projectNamed("v2"));
    });
    act(() => hook.result.current.undo());
    expect(hook.result.current.ref.current.name).toBe("v1");
  });

  it("coalesces edits of the same field into one undo step", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.update(projectNamed("a"), "cue:1");
      hook.result.current.update(projectNamed("ab"), "cue:1");
    });
    expect(hook.result.current.history.undo).toBe(1);
    act(() => hook.result.current.undo());
    expect(hook.result.current.ref.current.name).toBe("v0");
  });

  it("lists the states undo and redo can bring back, not the current one", () => {
    const { hook } = setup();
    act(() => hook.result.current.update(projectNamed("v1")));
    act(() => hook.result.current.update(projectNamed("v2")));
    act(() => hook.result.current.undo());
    expect(hook.result.current.snapshots().map((p) => p.name).sort()).toEqual(["v0", "v2"]);
  });
});
