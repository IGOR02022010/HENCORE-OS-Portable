/**
 * NanoPy - A Lightweight Python Interpreter in JavaScript
 * Copyright (c) 2026 Adolfo GM - MIT License
 */

class NanoPy {
    constructor(options = {}) {
        this.output = options.output || console.log;
        this.inputHandler = options.inputHandler || null;
        this.globals = {};
        this.callStack = [];
        this.pendingInput = null;
        this.inputResolve = null;
        this._initBuiltins();
    }

    _initBuiltins() {
        this.builtins = {
            print: (...args) => { this.output(args.map(a => this._repr(a, true)).join(' ')); },
            len: (obj) => obj.length !== undefined ? obj.length : Object.keys(obj).length,
            range: (...args) => {
                let start = 0, stop, step = 1;
                if (args.length === 1) stop = args[0];
                else if (args.length === 2) { start = args[0]; stop = args[1]; }
                else { start = args[0]; stop = args[1]; step = args[2]; }
                const r = [];
                if (step > 0) for (let i = start; i < stop; i += step) r.push(i);
                else for (let i = start; i > stop; i += step) r.push(i);
                return r;
            },
            int: (v) => parseInt(v, 10),
            float: (v) => ({ _pyFloat: true, value: parseFloat(v), valueOf() { return this.value; }, toString() { return Number.isInteger(this.value) ? this.value.toFixed(1) : String(this.value); } }),
            str: (v) => String(v),
            bool: (v) => Boolean(v),
            list: (v) => v ? Array.from(v) : [],
            dict: () => ({}),
            set: (v) => v ? [...new Set(v)] : [],
            tuple: (v) => v ? Object.freeze([...v]) : Object.freeze([]),
            type: (v) => `<class '${this._getType(v)}'>`,
            abs: Math.abs,
            min: (...a) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
            max: (...a) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
            sum: (arr) => arr.reduce((a, b) => a + b, 0),
            round: (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d,
            sorted: (arr) => [...arr].sort((a, b) => a - b),
            reversed: (arr) => [...arr].reverse(),
            enumerate: (arr) => arr.map((v, i) => [i, v]),
            zip: (...arrs) => arrs[0].map((_, i) => arrs.map(a => a[i])),
            map: (fn, arr) => arr.map(fn),
            filter: (fn, arr) => arr.filter(fn),
            any: (arr) => arr.some(Boolean),
            all: (arr) => arr.every(Boolean),
            ord: (c) => c.charCodeAt(0),
            chr: (n) => String.fromCharCode(n),
            isinstance: (obj, t) => this._getType(obj) === t,
            hasattr: (obj, attr) => obj && obj[attr] !== undefined,
            getattr: (obj, attr, def) => obj[attr] !== undefined ? obj[attr] : def,
            setattr: (obj, attr, val) => { obj[attr] = val; },
            input: async (prompt = '') => {
                if (prompt) this.output(prompt);
                if (this.inputHandler) return await this.inputHandler();
                return '';
            }
        };
        this.modules = {
            math: {
                pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, nan: NaN,
                sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, log10: Math.log10,
                sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
                floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, fabs: Math.abs
            },
            random: {
                random: Math.random,
                randint: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
                choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
                shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
                uniform: (a, b) => a + Math.random() * (b - a)
            }
        };
    }

    _getType(v) {
        if (v === null || v === undefined) return 'NoneType';
        if (Array.isArray(v)) return Object.isFrozen(v) ? 'tuple' : 'list';
        if (typeof v === 'object' && v._pyFloat) return 'float';
        if (typeof v === 'object') return 'dict';
        return typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v;
    }

    _repr(v, forPrint = false) {
        if (v === null || v === undefined) return 'None';
        if (typeof v === 'string') return forPrint ? v : `'${v}'`;
        if (typeof v === 'boolean') return v ? 'True' : 'False';
        if (Array.isArray(v)) {
            const inner = v.map(x => this._repr(x)).join(', ');
            return Object.isFrozen(v) ? `(${inner})` : `[${inner}]`;
        }
        if (typeof v === 'object') {
            if (v instanceof Set) return `{${[...v].map(x => this._repr(x)).join(', ')}}`;
            if (v._pyFloat) return v.toString();
            const entries = Object.entries(v).map(([k, val]) => `'${k}': ${this._repr(val)}`);
            return `{${entries.join(', ')}}`;
        }
        return String(v);
    }

    _tokenize(code) {
        const tokens = [];
        let i = 0;
        let lineStart = true;
        let currentIndent = 0;
        while (i < code.length) {
            if (lineStart) {
                currentIndent = 0;
                while (i < code.length && (code[i] === ' ' || code[i] === '\t')) {
                    currentIndent += code[i] === '\t' ? 4 : 1;
                    i++;
                }
                if (i < code.length && code[i] !== '\n' && code[i] !== '#') {
                    tokens.push({ type: 'INDENT', value: currentIndent });
                }
                lineStart = false;
            }
            if (code[i] === '#') { while (i < code.length && code[i] !== '\n') i++; continue; }
            if (code[i] === ' ' || code[i] === '\t') { i++; continue; }
            if (code[i] === '\n') { tokens.push({ type: 'NEWLINE', value: '\n' }); i++; lineStart = true; continue; }
            if (code.slice(i, i + 3) === '"""' || code.slice(i, i + 3) === "'''") {
                const q = code.slice(i, i + 3); i += 3; let s = '';
                while (i < code.length && code.slice(i, i + 3) !== q) s += code[i++];
                i += 3; tokens.push({ type: 'STRING', value: s }); continue;
            }
            if (code[i] === '"' || code[i] === "'") {
                const q = code[i++]; let s = '';
                while (i < code.length && code[i] !== q) { if (code[i] === '\\') { i++; s += code[i++]; } else s += code[i++]; }
                i++; tokens.push({ type: 'STRING', value: s }); continue;
            }
            if (code[i] === 'f' && (code[i + 1] === '"' || code[i + 1] === "'")) {
                i++; const q = code[i++]; let s = '';
                while (i < code.length && code[i] !== q) { if (code[i] === '\\') { i++; s += code[i++]; } else s += code[i++]; }
                i++; tokens.push({ type: 'FSTRING', value: s }); continue;
            }
            if (/[0-9]/.test(code[i]) || (code[i] === '.' && /[0-9]/.test(code[i + 1]))) {
                let n = '';
                while (i < code.length && /[0-9.]/.test(code[i])) n += code[i++];
                tokens.push({ type: 'NUMBER', value: n.includes('.') ? parseFloat(n) : parseInt(n, 10) }); continue;
            }
            const ops = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '//=', '**=', '%=', '&&', '||', '->', '...'];
            let found = false;
            for (const op of ops) { if (code.slice(i, i + op.length) === op) { tokens.push({ type: 'OP', value: op }); i += op.length; found = true; break; } }
            if (found) continue;
            if (/[+\-*/%<>=!&|^~@:,.\[\](){}]/.test(code[i])) { tokens.push({ type: 'OP', value: code[i++] }); continue; }
            if (/[a-zA-Z_]/.test(code[i])) {
                let id = '';
                while (i < code.length && /[a-zA-Z_0-9]/.test(code[i])) id += code[i++];
                const kws = ['if', 'elif', 'else', 'for', 'while', 'def', 'return', 'class', 'import', 'from', 'as', 'in', 'not', 'and', 'or', 'True', 'False', 'None', 'break', 'continue', 'pass', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal', 'assert', 'del', 'async', 'await'];
                tokens.push({ type: kws.includes(id) ? 'KEYWORD' : 'IDENT', value: id }); continue;
            }
            i++;
        }
        return tokens;
    }

    _parse(tokens) {
        const lines = []; let current = []; let currentIndent = 0;
        for (const tok of tokens) {
            if (tok.type === 'INDENT') { currentIndent = tok.value; }
            else if (tok.type === 'NEWLINE') { if (current.length) lines.push({ tokens: current, indent: currentIndent }); current = []; currentIndent = 0; }
            else current.push(tok);
        }
        if (current.length) lines.push({ tokens: current, indent: currentIndent });
        return lines;
    }

    async run(code) {
        try {
            const tokens = this._tokenize(code);
            const lines = this._parse(tokens);
            await this._execBlock(lines, 0, lines.length, this.globals);
        } catch (e) {
            this.output(`Error: ${e.message}`);
        }
    }

    async _execBlock(lines, start, end, scope) {
        let i = start;
        while (i < end) {
            const line = lines[i];
            const result = await this._execLine(line, lines, i, end, scope);
            if (result && result.type === 'return') return result;
            if (result && result.type === 'break') return result;
            if (result && result.type === 'continue') return result;
            if (result && result.skip) i = result.skip;
            else i++;
        }
    }

    async _execLine(line, lines, idx, end, scope) {
        const toks = line.tokens;
        if (!toks.length) return;

        if (toks[0].type === 'KEYWORD') {
            switch (toks[0].value) {
                case 'import': return this._handleImport(toks, scope);
                case 'from': return this._handleFromImport(toks, scope);
                case 'if': return await this._handleIf(toks, lines, idx, end, scope);
                case 'for': return await this._handleFor(toks, lines, idx, end, scope);
                case 'while': return await this._handleWhile(toks, lines, idx, end, scope);
                case 'def': return this._handleDef(toks, lines, idx, end, scope);
                case 'return': return { type: 'return', value: toks.length > 1 ? await this._evalExpr(toks.slice(1), scope) : undefined };
                case 'break': return { type: 'break' };
                case 'continue': return { type: 'continue' };
                case 'pass': return;
            }
        }

        const eqIdx = toks.findIndex((t, i) => t.type === 'OP' && t.value === '=' && (i === 0 || toks[i - 1].value !== '=' && toks[i - 1].value !== '!' && toks[i - 1].value !== '<' && toks[i - 1].value !== '>') && (i === toks.length - 1 || toks[i + 1].value !== '='));
        if (eqIdx > 0) {
            const augOps = ['+=', '-=', '*=', '/=', '//=', '**=', '%='];
            const prevTok = toks[eqIdx - 1];
            if (prevTok && augOps.some(op => op[0] === prevTok.value)) {
                const op = prevTok.value;
                const target = toks.slice(0, eqIdx - 1);
                const value = await this._evalExpr(toks.slice(eqIdx + 1), scope);
                const current = await this._evalExpr(target, scope);
                const newVal = this._applyOp(current, value, op);
                return this._assign(target, newVal, scope);
            }
            const target = toks.slice(0, eqIdx);
            const value = await this._evalExpr(toks.slice(eqIdx + 1), scope);
            return this._assign(target, value, scope);
        }

        await this._evalExpr(toks, scope);
    }

    _handleImport(toks, scope) {
        const modName = toks[1].value;
        if (this.modules[modName]) scope[modName] = this.modules[modName];
    }

    _handleFromImport(toks, scope) {
        const modName = toks[1].value;
        const importIdx = toks.findIndex(t => t.type === 'KEYWORD' && t.value === 'import');
        if (importIdx > 0 && this.modules[modName]) {
            for (let i = importIdx + 1; i < toks.length; i++) {
                if (toks[i].type === 'IDENT') {
                    const name = toks[i].value;
                    if (this.modules[modName][name] !== undefined) scope[name] = this.modules[modName][name];
                }
            }
        }
    }

    async _handleIf(toks, lines, idx, end, scope) {
        const colonIdx = toks.findIndex(t => t.type === 'OP' && t.value === ':');
        const cond = await this._evalExpr(toks.slice(1, colonIdx), scope);
        const blockEnd = this._findBlockEnd(lines, idx, end);

        if (cond) {
            const result = await this._execBlock(lines, idx + 1, blockEnd, scope);
            if (result && (result.type === 'return' || result.type === 'break' || result.type === 'continue')) return result;
            let next = blockEnd;
            while (next < end && lines[next].tokens[0]?.value === 'elif') next = this._findBlockEnd(lines, next, end);
            if (next < end && lines[next].tokens[0]?.value === 'else') next = this._findBlockEnd(lines, next, end);
            return { skip: next };
        } else {
            let next = blockEnd;
            while (next < end) {
                if (lines[next].tokens[0]?.type === 'KEYWORD' && lines[next].tokens[0]?.value === 'elif') {
                    const elifColonIdx = lines[next].tokens.findIndex(t => t.type === 'OP' && t.value === ':');
                    const elifCond = await this._evalExpr(lines[next].tokens.slice(1, elifColonIdx), scope);
                    const elifBlockEnd = this._findBlockEnd(lines, next, end);
                    if (elifCond) {
                        const result = await this._execBlock(lines, next + 1, elifBlockEnd, scope);
                        if (result && (result.type === 'return' || result.type === 'break' || result.type === 'continue')) return result;
                        let skip = elifBlockEnd;
                        while (skip < end && lines[skip].tokens[0]?.value === 'elif') skip = this._findBlockEnd(lines, skip, end);
                        if (skip < end && lines[skip].tokens[0]?.value === 'else') skip = this._findBlockEnd(lines, skip, end);
                        return { skip };
                    }
                    next = elifBlockEnd;
                } else if (lines[next].tokens[0]?.value === 'else') {
                    const elseBlockEnd = this._findBlockEnd(lines, next, end);
                    const result = await this._execBlock(lines, next + 1, elseBlockEnd, scope);
                    if (result && (result.type === 'return' || result.type === 'break' || result.type === 'continue')) return result;
                    return { skip: elseBlockEnd };
                } else break;
            }
            return { skip: next };
        }
    }

    async _handleFor(toks, lines, idx, end, scope) {
        const inIdx = toks.findIndex(t => t.type === 'KEYWORD' && t.value === 'in');
        const colonIdx = toks.findIndex(t => t.type === 'OP' && t.value === ':');
        const varName = toks[1].value;
        const iterable = await this._evalExpr(toks.slice(inIdx + 1, colonIdx), scope);
        const blockEnd = this._findBlockEnd(lines, idx, end);

        for (const item of iterable) {
            scope[varName] = item;
            const result = await this._execBlock(lines, idx + 1, blockEnd, scope);
            if (result && result.type === 'return') return result;
            if (result && result.type === 'break') break;
        }
        return { skip: blockEnd };
    }

    async _handleWhile(toks, lines, idx, end, scope) {
        const colonIdx = toks.findIndex(t => t.type === 'OP' && t.value === ':');
        const blockEnd = this._findBlockEnd(lines, idx, end);

        while (await this._evalExpr(toks.slice(1, colonIdx), scope)) {
            const result = await this._execBlock(lines, idx + 1, blockEnd, scope);
            if (result && result.type === 'return') return result;
            if (result && result.type === 'break') break;
        }
        return { skip: blockEnd };
    }

    _handleDef(toks, lines, idx, end, scope) {
        const name = toks[1].value;
        const colonIdx = toks.findIndex(t => t.type === 'OP' && t.value === ':');
        const paramToks = toks.slice(3, colonIdx - 1);
        const params = [];
        const defaults = {};
        let i = 0;
        while (i < paramToks.length) {
            if (paramToks[i].type === 'IDENT') {
                const pname = paramToks[i].value;
                if (paramToks[i + 1]?.type === 'OP' && paramToks[i + 1]?.value === '=') {
                    defaults[pname] = paramToks[i + 2].type === 'NUMBER' ? paramToks[i + 2].value : paramToks[i + 2].type === 'STRING' ? paramToks[i + 2].value : null;
                    i += 3;
                } else {
                    params.push(pname);
                    i++;
                }
            } else i++;
        }
        const blockEnd = this._findBlockEnd(lines, idx, end);
        const body = lines.slice(idx + 1, blockEnd);

        scope[name] = async (...args) => {
            const localScope = { ...scope };
            params.forEach((p, i) => localScope[p] = args[i]);
            Object.entries(defaults).forEach(([k, v]) => { if (localScope[k] === undefined) localScope[k] = args[params.length] ?? v; });
            const result = await this._execBlock(body, 0, body.length, localScope);
            return result && result.type === 'return' ? result.value : undefined;
        };
        return { skip: blockEnd };
    }

    _findBlockEnd(lines, idx, end) {
        const baseIndent = lines[idx].indent;
        let i = idx + 1;
        while (i < end && (lines[i].indent > baseIndent || !lines[i].tokens.length)) i++;
        return i;
    }

    _assign(target, value, scope) {
        if (target.length === 1 && target[0].type === 'IDENT') {
            scope[target[0].value] = value;
        } else {
            const bracketIdx = target.findIndex(t => t.value === '[');
            if (bracketIdx > 0) {
                const obj = this._resolve(target[0].value, scope);
                const key = target[bracketIdx + 1].type === 'STRING' ? target[bracketIdx + 1].value : target[bracketIdx + 1].value;
                obj[key] = value;
            }
        }
    }

    _resolve(name, scope) {
        if (scope[name] !== undefined) return scope[name];
        if (this.globals[name] !== undefined) return this.globals[name];
        if (this.builtins[name] !== undefined) return this.builtins[name];
        return undefined;
    }

    async _evalExpr(toks, scope) {
        if (!toks.length) return undefined;

        toks = toks.filter(t => t.type !== 'NEWLINE' && t.type !== 'INDENT');

        let depth = 0;
        let ifIdx = -1;
        let elseIdx = -1;

        for (let k = 0; k < toks.length; k++) {
            if (toks[k].type === 'OP' && (toks[k].value === '(' || toks[k].value === '[' || toks[k].value === '{')) depth++;
            else if (toks[k].type === 'OP' && (toks[k].value === ')' || toks[k].value === ']' || toks[k].value === '}')) depth--;
            else if (depth === 0 && toks[k].type === 'KEYWORD') {
                if (toks[k].value === 'if' && ifIdx === -1) { ifIdx = k; }
                else if (toks[k].value === 'else' && ifIdx !== -1) { elseIdx = k; break; }
            }
        }

        if (ifIdx > 0 && elseIdx > ifIdx) {
            const condToks = toks.slice(ifIdx + 1, elseIdx);
            const cond = await this._evalExpr(condToks, scope);
            if (cond) return await this._evalExpr(toks.slice(0, ifIdx), scope);
            else return await this._evalExpr(toks.slice(elseIdx + 1), scope);
        }

        const findIdx = (types, values) => {
            let depth = 0;
            for (let i = 0; i < toks.length; i++) {
                if (toks[i].type === 'OP' && (toks[i].value === '(' || toks[i].value === '[' || toks[i].value === '{')) depth++;
                else if (toks[i].type === 'OP' && (toks[i].value === ')' || toks[i].value === ']' || toks[i].value === '}')) depth--;
                else if (depth === 0) {
                    if (types.includes(toks[i].type) && values.includes(toks[i].value)) return i;
                }
            }
            return -1;
        };

        const orIdx = findIdx(['KEYWORD'], ['or']);
        if (orIdx > 0) {
            const left = await this._evalExpr(toks.slice(0, orIdx), scope);
            return left ? left : await this._evalExpr(toks.slice(orIdx + 1), scope);
        }

        const andIdx = findIdx(['KEYWORD'], ['and']);
        if (andIdx > 0) {
            const left = await this._evalExpr(toks.slice(0, andIdx), scope);
            return left ? await this._evalExpr(toks.slice(andIdx + 1), scope) : left;
        }

        const notIdx = findIdx(['KEYWORD'], ['not']);
        if (notIdx === 0) return !(await this._evalExpr(toks.slice(1), scope));

        const compOpIdx = findIdx(['OP', 'KEYWORD'], ['==', '!=', '<=', '>=', '<', '>', 'in']);
        if (compOpIdx > 0) {
            const op = toks[compOpIdx].value;
            const left = await this._evalExpr(toks.slice(0, compOpIdx), scope);
            const right = await this._evalExpr(toks.slice(compOpIdx + 1), scope);
            if (op === 'in') return Array.isArray(right) ? right.includes(left) : typeof right === 'string' ? right.includes(left) : left in right;
            return this._compare(left, right, op);
        }

        return this._evalAddSub(toks, scope);
    }

    async _evalAddSub(toks, scope) {
        let result = null; let op = '+'; let i = 0;
        while (i < toks.length) {
            const sublength = this._findTermEnd(toks, i);
            const term = await this._evalMulDiv(toks.slice(i, i + sublength), scope);
            if (result === null) result = term;
            else if (op === '+') {
                if (Array.isArray(result) && Array.isArray(term)) result = result.concat(term);
                else result = typeof result === 'string' || typeof term === 'string' ? String(result) + String(term) : result + term;
            }
            else if (op === '-') result = result - term;
            i += sublength;
            if (i < toks.length && toks[i].type === 'OP' && (toks[i].value === '+' || toks[i].value === '-')) { op = toks[i].value; i++; }
        }
        return result;
    }

    _findTermEnd(toks, start) {
        let depth = 0; let i = start;
        while (i < toks.length) {
            if (toks[i].type === 'OP' && (toks[i].value === '(' || toks[i].value === '[' || toks[i].value === '{')) depth++;
            else if (toks[i].type === 'OP' && (toks[i].value === ')' || toks[i].value === ']' || toks[i].value === '}')) depth--;
            else if (depth === 0 && toks[i].type === 'OP' && (toks[i].value === '+' || toks[i].value === '-')) break;
            i++;
        }
        return i - start;
    }

    async _evalMulDiv(toks, scope) {
        let result = null; let op = '*'; let i = 0;
        while (i < toks.length) {
            const sublength = this._findFactorEnd(toks, i);
            const factor = await this._evalPower(toks.slice(i, i + sublength), scope);
            if (result === null) result = factor;
            else if (op === '*') {
                if (Array.isArray(result)) {
                    const newArr = [];
                    for (let k = 0; k < factor; k++) newArr.push(...result);
                    result = newArr;
                } else {
                    result = typeof result === 'string' ? result.repeat(factor) : result * factor;
                }
            }
            else if (op === '/') result = result / factor;
            else if (op === '//') result = Math.floor(result / factor);
            else if (op === '%') result = result % factor;
            i += sublength;
            if (i < toks.length && toks[i].type === 'OP' && ['*', '/', '//', '%'].includes(toks[i].value)) { op = toks[i].value; i++; }
        }
        return result;
    }

    _findFactorEnd(toks, start) {
        let depth = 0; let i = start;
        while (i < toks.length) {
            if (toks[i].type === 'OP' && (toks[i].value === '(' || toks[i].value === '[' || toks[i].value === '{')) depth++;
            else if (toks[i].type === 'OP' && (toks[i].value === ')' || toks[i].value === ']' || toks[i].value === '}')) depth--;
            else if (depth === 0 && toks[i].type === 'OP' && ['*', '/', '//', '%'].includes(toks[i].value)) break;
            i++;
        }
        return i - start;
    }

    async _evalPower(toks, scope) {
        const powIdx = toks.findIndex(t => t.type === 'OP' && t.value === '**');
        if (powIdx > 0) {
            const base = await this._evalUnary(toks.slice(0, powIdx), scope);
            const exp = await this._evalPower(toks.slice(powIdx + 1), scope);
            return Math.pow(base, exp);
        }
        return this._evalUnary(toks, scope);
    }

    async _evalUnary(toks, scope) {
        if (toks[0]?.type === 'OP' && toks[0]?.value === '-') return -(await this._evalUnary(toks.slice(1), scope));
        if (toks[0]?.type === 'OP' && toks[0]?.value === '+') return +(await this._evalUnary(toks.slice(1), scope));
        return this._evalPrimary(toks, scope);
    }

    async _evalPrimary(toks, scope) {
        if (!toks.length) return undefined;

        if (toks[0].type === 'OP' && toks[0].value === '(' && toks[toks.length - 1].type === 'OP' && toks[toks.length - 1].value === ')') {
            const inner = toks.slice(1, -1);
            if (this._isTuple(inner)) return Object.freeze(await this._parseList(inner, scope));
            return this._evalExpr(inner, scope);
        }

        if (toks[0].type === 'OP' && toks[0].value === '[' && toks[toks.length - 1].type === 'OP' && toks[toks.length - 1].value === ']') return this._parseList(toks.slice(1, -1), scope);

        if (toks[0].type === 'OP' && toks[0].value === '{' && toks[toks.length - 1].type === 'OP' && toks[toks.length - 1].value === '}') {
            const inner = toks.slice(1, -1);
            if (inner.some(t => t.type === 'OP' && t.value === ':')) return this._parseDict(inner, scope);
            return new Set(await this._parseList(inner, scope));
        }

        if (toks[0].type === 'FSTRING') {
            let value = await this._evalFString(toks[0].value, scope);
            let i = 1;
            return await this._processChain(value, toks, i, scope);
        }

        if (toks[0].type === 'STRING') {
            let value = toks[0].value;
            let i = 1;
            return await this._processChain(value, toks, i, scope);
        }

        if (toks[0].type === 'NUMBER') {
            let value = toks[0].value;
            let i = 1;
            return await this._processChain(value, toks, i, scope);
        }

        if (toks[0].type === 'KEYWORD' && toks[0].value === 'True') return true;
        if (toks[0].type === 'KEYWORD' && toks[0].value === 'False') return false;
        if (toks[0].type === 'KEYWORD' && toks[0].value === 'None') return null;

        if (toks[0].type === 'IDENT') {
            let value = this._resolve(toks[0].value, scope);
            let i = 1;
            return await this._processChain(value, toks, i, scope);
        }
        return undefined;
    }

    async _processChain(value, toks, i, scope) {
        while (i < toks.length) {
            if (toks[i].type === 'OP' && toks[i].value === '.') {
                const attr = toks[i + 1].value;
                if (typeof value === 'string') value = this._getStringMethod(value, attr);
                else if (Array.isArray(value)) value = this._getListMethod(value, attr);
                else if (typeof value === 'object' && value !== null) value = this._getDictMethod(value, attr);
                i += 2;
            } else if (toks[i].type === 'OP' && toks[i].value === '(') {
                const closeIdx = this._findMatchingParen(toks, i);
                const args = await this._parseArgs(toks.slice(i + 1, closeIdx), scope);
                if (typeof value === 'function') value = await value(...args);
                else value = undefined;
                i = closeIdx + 1;
            } else if (toks[i].type === 'OP' && toks[i].value === '[') {
                const closeIdx = this._findMatchingBracket(toks, i);
                const idx = await this._evalExpr(toks.slice(i + 1, closeIdx), scope);
                value = value[idx];
                i = closeIdx + 1;
            } else break;
        }
        return value;
    }

    _isTuple(toks) {
        let depth = 0;
        for (const t of toks) {
            if (t.type === 'OP' && (t.value === '(' || t.value === '[' || t.value === '{')) depth++;
            else if (t.type === 'OP' && (t.value === ')' || t.value === ']' || t.value === '}')) depth--;
            else if (depth === 0 && t.type === 'OP' && t.value === ',') return true;
        }
        return false;
    }

    async _parseList(toks, scope) {
        let depth = 0;
        let forIdx = -1;
        for (let i = 0; i < toks.length; i++) {
            if (toks[i].type === 'OP' && (toks[i].value === '(' || toks[i].value === '[' || toks[i].value === '{')) depth++;
            else if (toks[i].type === 'OP' && (toks[i].value === ')' || toks[i].value === ']' || toks[i].value === '}')) depth--;
            else if (depth === 0 && toks[i].type === 'KEYWORD' && toks[i].value === 'for') {
                forIdx = i;
                break;
            }
        }

        if (forIdx > 0) {
            const exprToks = toks.slice(0, forIdx);
            const tailToks = toks.slice(forIdx + 1);
            let inIdx = -1;
            depth = 0;
            for (let i = 0; i < tailToks.length; i++) {
                if (tailToks[i].type === 'OP' && (tailToks[i].value === '(' || tailToks[i].value === '[' || tailToks[i].value === '{')) depth++;
                else if (tailToks[i].type === 'OP' && (tailToks[i].value === ')' || tailToks[i].value === ']' || tailToks[i].value === '}')) depth--;
                else if (depth === 0 && tailToks[i].type === 'KEYWORD' && tailToks[i].value === 'in') {
                    inIdx = i;
                    break;
                }
            }
            if (inIdx > 0) {
                const varName = tailToks[0].value;
                const iterable = await this._evalExpr(tailToks.slice(inIdx + 1), scope);
                if (!iterable || typeof iterable[Symbol.iterator] !== 'function') {
                    this.output("Error: Iterable is not iterable in comprehension");
                    return [];
                }
                const result = [];
                for (const item of iterable) {
                    const localScope = { ...scope, [varName]: item };
                    result.push(await this._evalExpr(exprToks, localScope));
                }
                return result;
            }
        }

        const items = []; let current = []; depth = 0;
        for (const t of toks) {
            if (t.type === 'OP' && (t.value === '(' || t.value === '[' || t.value === '{')) { depth++; current.push(t); }
            else if (t.type === 'OP' && (t.value === ')' || t.value === ']' || t.value === '}')) { depth--; current.push(t); }
            else if (depth === 0 && t.type === 'OP' && t.value === ',') { if (current.length) items.push(await this._evalExpr(current, scope)); current = []; }
            else current.push(t);
        }
        if (current.length) items.push(await this._evalExpr(current, scope));
        return items;
    }

    async _parseDict(toks, scope) {
        const obj = {}; let key = []; let val = []; let inVal = false; let depth = 0;
        for (const t of toks) {
            if (t.type === 'OP' && (t.value === '(' || t.value === '[' || t.value === '{')) { depth++; (inVal ? val : key).push(t); }
            else if (t.type === 'OP' && (t.value === ')' || t.value === ']' || t.value === '}')) { depth--; (inVal ? val : key).push(t); }
            else if (depth === 0 && t.type === 'OP' && t.value === ':') { inVal = true; }
            else if (depth === 0 && t.type === 'OP' && t.value === ',') { obj[await this._evalExpr(key, scope)] = await this._evalExpr(val, scope); key = []; val = []; inVal = false; }
            else (inVal ? val : key).push(t);
        }
        if (key.length) obj[await this._evalExpr(key, scope)] = await this._evalExpr(val, scope);
        return obj;
    }

    async _parseArgs(toks, scope) {
        return this._parseList(toks, scope);
    }

    _findMatchingParen(toks, start) {
        let depth = 1; let i = start + 1;
        while (i < toks.length && depth > 0) {
            if (toks[i].type === 'OP' && toks[i].value === '(') depth++;
            else if (toks[i].type === 'OP' && toks[i].value === ')') depth--;
            i++;
        }
        return i - 1;
    }

    _findMatchingBracket(toks, start) {
        let depth = 1; let i = start + 1;
        while (i < toks.length && depth > 0) {
            if (toks[i].type === 'OP' && toks[i].value === '[') depth++;
            else if (toks[i].type === 'OP' && toks[i].value === ']') depth--;
            i++;
        }
        return i - 1;
    }

    async _evalFString(template, scope) {
        let result = ''; let i = 0;
        while (i < template.length) {
            if (template[i] === '{' && template[i + 1] !== '{') {
                let expr = ''; let depth = 1; i++;
                while (i < template.length && depth > 0) {
                    if (template[i] === '{') depth++;
                    else if (template[i] === '}') depth--;
                    if (depth > 0) expr += template[i];
                    i++;
                }
                const tokens = this._tokenize(expr);
                const value = await this._evalExpr(tokens, scope);
                result += this._repr(value, true);
            } else if (template[i] === '\\' && template[i + 1] === 'n') { result += '\n'; i += 2; }
            else result += template[i++];
        }
        return result;
    }

    _getStringMethod(str, method) {
        const methods = {
            strip: () => str.trim(),
            lstrip: () => str.trimStart(),
            rstrip: () => str.trimEnd(),
            upper: () => str.toUpperCase(),
            lower: () => str.toLowerCase(),
            capitalize: () => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(),
            title: () => str.replace(/\b\w/g, c => c.toUpperCase()),
            split: (sep) => sep ? str.split(sep) : str.split(/\s+/).filter(Boolean),
            join: (arr) => arr.join(str),
            replace: (old, nw) => str.replace(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), nw),
            startswith: (s) => str.startsWith(s),
            endswith: (s) => str.endsWith(s),
            find: (s) => str.indexOf(s),
            count: (s) => (str.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
            isdigit: () => /^\d+$/.test(str),
            isalpha: () => /^[a-zA-Z]+$/.test(str),
            isalnum: () => /^[a-zA-Z0-9]+$/.test(str)
        };
        return methods[method] || (() => undefined);
    }

    _getListMethod(arr, method) {
        const methods = {
            append: (v) => { arr.push(v); return undefined; },
            insert: (i, v) => { arr.splice(i, 0, v); return undefined; },
            pop: (i) => i !== undefined ? arr.splice(i, 1)[0] : arr.pop(),
            remove: (v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); return undefined; },
            clear: () => { arr.length = 0; return undefined; },
            index: (v) => arr.indexOf(v),
            count: (v) => arr.filter(x => x === v).length,
            reverse: () => { arr.reverse(); return undefined; },
            sort: () => { arr.sort((a, b) => a - b); return undefined; },
            copy: () => [...arr],
            extend: (other) => { arr.push(...other); return undefined; }
        };
        return methods[method] || (() => undefined);
    }

    _getDictMethod(obj, method) {
        const methods = {
            keys: () => Object.keys(obj),
            values: () => Object.values(obj),
            items: () => Object.entries(obj).map(([k, v]) => [k, v]),
            get: (k, def) => obj[k] !== undefined ? obj[k] : def,
            update: (other) => { Object.assign(obj, other); return undefined; },
            pop: (k, def) => { const v = obj[k]; if (v !== undefined) { delete obj[k]; return v; } return def; },
            clear: () => { for (const k in obj) delete obj[k]; return undefined; },
            copy: () => ({ ...obj }),
            setdefault: (k, def) => { if (obj[k] === undefined) obj[k] = def; return obj[k]; }
        };
        if (methods[method]) return methods[method];
        return obj[method];
    }

    _compare(a, b, op) {
        switch (op) {
            case '==': return a === b || JSON.stringify(a) === JSON.stringify(b);
            case '!=': return a !== b && JSON.stringify(a) !== JSON.stringify(b);
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
        }
    }

    _applyOp(a, b, op) {
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return a / b;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { NanoPy };
if (typeof window !== 'undefined') window.NanoPy = NanoPy;
