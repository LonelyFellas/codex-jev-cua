// Adapted from Sac-Y/Jev-cu createCuaDriver. See NOTICE.md.
import type { Direction, Driver } from "./types.ts";

export interface CuaApp {
  getAXState(options: { emit: false; disableDiffing: true }): Promise<string>;
  click?(index: number): Promise<unknown>;
  setValue?(index: number, value: string): Promise<unknown>;
  typeText?(text: string): Promise<unknown>;
  pressKey?(key: string): Promise<unknown>;
  scroll?(index: number, direction: Direction, pages: number): Promise<unknown>;
}
export interface CuaRuntime { getApp(name: string): Promise<CuaApp> }

export async function withReadRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || !/ScreenCaptureKit|-10005|timeout/i.test(String(error))) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }
  }
}
export function createCuaDriver(cua: CuaRuntime): Driver {
  let app: CuaApp | undefined;
  function bound(): CuaApp {
    if (!app) throw new Error("Call bind before using the driver.");
    return app;
  }
  return {
    async bind(name) {
      app = undefined;
      const next = await cua.getApp(name);
      if (!next || typeof next.getAXState !== "function") throw new Error("Unsupported cua runtime: missing getAXState; read current tool documentation before adapting.");
      app = next;
    },
    async observe() {
      const value = await withReadRetry(() => bound().getAXState({ emit: false, disableDiffing: true }));
      if (typeof value !== "string") throw new Error("Unsupported getAXState response: expected full AX text.");
      return value;
    },
    async click(index) {
      const a = bound(); if (!a.click) throw new Error("cua click unavailable.");
      return a.click(index);
    },
    async setValue(index, value) {
      const a = bound(); if (!a.setValue) throw new Error("cua setValue unavailable.");
      return a.setValue(index, value);
    },
    async typeText(text) {
      const a = bound(); if (!a.typeText) throw new Error("cua typeText unavailable.");
      return a.typeText(text);
    },
    async pressKey(key) {
      const a = bound(); if (!a.pressKey) throw new Error("cua pressKey unavailable.");
      return a.pressKey(key);
    },
    async scroll(index, direction, pages) {
      const a = bound(); if (!a.scroll) throw new Error("cua scroll unavailable.");
      return a.scroll(index, direction, pages);
    },
  };
}
