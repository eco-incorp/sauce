#!/bin/bash
# run.sh <mode A|B> <model-short> <model-id> [attempt]
# One headless run: the task, then a feedback question in the same session. Transcripts land in
# $E/<mode>-<short>[-<attempt>]/; files the agent wrote are moved there after the run.
set -u
mode=$1; short=$2; model=$3; attempt=${4:-1}
E=/Users/er/Documents/Projects/v12-class/sol-dswap-evals
C=$E/config
name=$mode-$short; [ "$attempt" != 1 ] && name=$name-r$attempt
out=$E/$name; mkdir -p $out
if [ "$mode" = A ]; then dir=/Users/er/Documents/Projects/sauce-agent-demo; mcp=$C/mcp-none.json
else dir=/Users/er/Documents/Projects/sauce-agent-demo-mcp; mcp=$C/mcp-B.json; fi
TASK="Do a distributed swap on Solana: sell 500 USDC for SOL (or a pair you choose with real pools) across every venue that supports a price limit, never below 0.0084 SOL per USDC, and rehearse it with sauce simulate. It is a rehearsal only: use no keys and send nothing."
FEEDBACK="Thanks. Looking back at this task: what in the Sauce skills, the sauce CLI or the sauce MCP tools (whichever you used) was missing, wrong or misleading? For each issue name the skill and section, or the command or tool, what you expected and what happened. Most important first, concrete and brief."
common=(--model "$model" --permission-mode bypassPermissions --settings $C/settings-$mode.json --setting-sources project,local --strict-mcp-config --mcp-config $mcp --max-budget-usd 40 --output-format stream-json --verbose)
cd $dir
touch $out/.start
start=$(date +%s)
echo "$TASK" > $out/task.txt
claude -p "$TASK" "${common[@]}" > $out/transcript.jsonl 2> $out/stderr.txt
end=$(date +%s)
echo $((end-start)) > $out/seconds.txt
sid=$(python3 -c "
import json,sys
for l in open('$out/transcript.jsonl'):
    try: d=json.loads(l)
    except: continue
    if d.get('session_id'): print(d['session_id']); break")
echo $sid > $out/session.txt
claude -p "$FEEDBACK" --resume "$sid" "${common[@]}" > $out/feedback.jsonl 2>> $out/stderr.txt
# Files the agent wrote: moved out so the next run does not see them.
mkdir -p $out/files
find . -newer $out/.start -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.claude/skills/*' -not -path './.agents/skills/*' > $out/written.txt
while read -r f; do
  rel=${f#./}
  if git ls-files --error-unmatch "$rel" >/dev/null 2>&1; then echo "TRACKED-MODIFIED $rel" >> $out/written.txt; cp "$rel" "$out/files/$(echo $rel | tr / _)"; continue; fi
  mkdir -p "$out/files/$(dirname "$rel")"; mv "$rel" "$out/files/$rel"
done < <(find . -newer $out/.start -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.claude/skills/*' -not -path './.agents/skills/*')
echo "done $name $(cat $out/seconds.txt)s"
