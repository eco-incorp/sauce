import { CompilerContext } from '../src/context.js';

describe('CompilerContext', () => {
  describe('setVar / getVar', () => {
    it('stores and retrieves a variable', () => {
      const ctx = new CompilerContext();
      ctx.setVar('x');

      const result = ctx.getVar('x');
      expect(result).toBeDefined();
      expect(result?.name).toBe('x');
    });

    it('returns undefined for unknown variable', () => {
      const ctx = new CompilerContext();
      expect(ctx.getVar('unknown')).toBeUndefined();
    });

    it('throws on duplicate variable in same scope', () => {
      const ctx = new CompilerContext();
      ctx.setVar('x');
      expect(() => ctx.setVar('x')).toThrow("variable 'x' is already declared");
    });

    it('assigns incrementing slots to variables', () => {
      const ctx = new CompilerContext();
      const a = ctx.setVar('a');
      const b = ctx.setVar('b');
      const c = ctx.setVar('c');

      expect(a.slot).toBe(0);
      expect(b.slot).toBe(1);
      expect(c.slot).toBe(2);
      expect(ctx.slotCount).toBe(3);
    });
  });

  describe('scopes', () => {
    it('allows shadowing in nested scope', () => {
      const ctx = new CompilerContext();

      ctx.setVar('x');
      const outerSlot = ctx.getVar('x')?.slot;

      ctx.pushScope();
      ctx.setVar('x');
      const innerSlot = ctx.getVar('x')?.slot;

      expect(innerSlot).not.toBe(outerSlot);

      ctx.popScope();
      expect(ctx.getVar('x')?.slot).toBe(outerSlot);
    });

    it('looks up variable in parent scope', () => {
      const ctx = new CompilerContext();

      ctx.setVar('x');
      const slot = ctx.getVar('x')?.slot;

      ctx.pushScope();

      expect(ctx.getVar('x')?.slot).toBe(slot);
    });

    it('throws when popping global scope', () => {
      const ctx = new CompilerContext();
      expect(() => ctx.popScope()).toThrow('cannot pop global scope');
    });
  });

  describe('warn', () => {
    it('collects warnings', () => {
      const ctx = new CompilerContext();
      ctx.warn('warning 1');
      ctx.warn('warning 2');

      expect(ctx.warnings).toEqual(['warning 1', 'warning 2']);
    });
  });

  describe('freshTemp', () => {
    it('allocates uniquely-named scratch locals that cannot collide with user vars', () => {
      const ctx = new CompilerContext();
      const a = ctx.freshTemp();
      const b = ctx.freshTemp();

      expect(a).not.toBe(b);
      expect(a.startsWith('#')).toBe(true); // `#` is unparseable as a SauceScript identifier
      expect(ctx.getVar(a)).toBeDefined();
    });
  });

  describe('v12 stack params', () => {
    it('marks params with isParam (no slot) and tracks absolute + relative stack positions', () => {
      const ctx = new CompilerContext([], {}, 'v12');
      ctx.setVar('p', 'scalar', undefined, undefined, true);
      ctx.pushStack('p');
      ctx.setVar('q', 'scalar', undefined, undefined, true);
      ctx.pushStack('q');

      expect(ctx.getVar('p')?.isParam).toBe(true);
      expect(ctx.getVar('p')?.slot).toBe(-1); // params live on the stack, not a memory slot
      // absolute (push order): p first, q second
      expect(ctx.getStackVarPos('p')).toBe(1);
      expect(ctx.getStackVarPos('q')).toBe(2);
      // relative-from-top: q is on top (1), p below it (2)
      expect(ctx.findStackVar('q')).toBe(1);
      expect(ctx.findStackVar('p')).toBe(2);
    });
  });
});
