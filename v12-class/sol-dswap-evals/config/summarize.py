#!/usr/bin/env python3
"""summarize.py <run dir> [--full]: a run's tool timeline, errors, result and cost, URLs masked."""
import json, re, sys, os

URL = re.compile(r'https?://[^\s"\'\\)]+')
def mask(s):
    return URL.sub(lambda m: m.group(0) if re.match(r'https?://(github\.com|127\.0\.0\.1|localhost)', m.group(0)) else '<url>', s)

def load(path):
    out = []
    if not os.path.exists(path): return out
    for line in open(path):
        try: out.append(json.loads(line))
        except Exception: pass
    return out

def timeline(events, full):
    n = 0
    for e in events:
        if e.get('type') == 'assistant':
            for c in e['message'].get('content', []):
                if c.get('type') == 'tool_use':
                    n += 1
                    inp = c.get('input', {})
                    s = inp.get('command') or inp.get('file_path') or inp.get('pattern') or json.dumps(inp)
                    print(f"  [{n}] {c['name']}: {mask(str(s))[:None if full else 220]}")
                elif c.get('type') == 'text' and full:
                    print('  TEXT:', mask(c['text'])[:600])
        elif e.get('type') == 'user':
            for c in e['message'].get('content', []) if isinstance(e['message'].get('content'), list) else []:
                if c.get('type') == 'tool_result' and c.get('is_error'):
                    t = c.get('content')
                    t = t if isinstance(t, str) else json.dumps(t)
                    print('      ERROR:', mask(t)[:None if full else 300].replace('\n', ' | '))
    return n

def result(events):
    for e in events:
        if e.get('type') == 'result':
            return e
    return {}

d = sys.argv[1]; full = '--full' in sys.argv
t = load(os.path.join(d, 'transcript.jsonl')); f = load(os.path.join(d, 'feedback.jsonl'))
print('==', os.path.basename(d), '==')
n = timeline(t, full)
r = result(t); fr = result(f)
secs = open(os.path.join(d, 'seconds.txt')).read().strip() if os.path.exists(os.path.join(d, 'seconds.txt')) else '?'
print(f"tools {n}, turns {r.get('num_turns')}, cost ${r.get('total_cost_usd', 0):.2f} (+feedback ${fr.get('total_cost_usd', 0) or 0:.2f}), {secs}s, subtype {r.get('subtype')}")
print('RESULT:\n' + mask(str(r.get('result', '')))[:None if full else 4000])
print('FEEDBACK:\n' + mask(str(fr.get('result', '')))[:None if full else 6000])
