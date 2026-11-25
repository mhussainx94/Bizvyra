set -u
A=88151cf
echo "### HEAD and attempt-1 commit"
git --no-optional-locks rev-parse HEAD $A
echo; echo "### Product-tree diff attempt-1 commit ($A) vs HEAD, excluding .ai/ (empty = identical)"
git --no-optional-locks diff --stat $A HEAD -- . ':(exclude).ai'
echo "(end of diff)"
echo; echo "### Working tree vs HEAD outside .ai/ (empty = clean)"
git --no-optional-locks status --short -- . ':(exclude).ai'
echo "(end of status)"
echo; echo "### sha256: working tree vs blob at $A, for every non-.ai path changed by attempt 1"
mism=0; n=0
for p in $(git --no-optional-locks show --name-only --format= $A | grep -v '^\.ai/'); do
  n=$((n+1)); w=$(sha256sum "$p" | cut -c1-64); c=$(git --no-optional-locks show "$A:$p" | sha256sum | cut -c1-64)
  if [ "$w" = "$c" ]; then s=SAME; else s=DIFF; mism=$((mism+1)); fi
  echo "$s $w $p"
done
echo "files=$n mismatches=$mism"
echo; echo "### Owner-added docs (must be unchanged vs HEAD)"
for p in docs/api-contract.md docs/tasks/T002.md package.json package-lock.json; do echo "$(sha256sum $p | cut -c1-64) worktree  $p"; echo "$(git --no-optional-locks show HEAD:$p | sha256sum | cut -c1-64) HEAD      $p"; done
echo; echo "### C1 scripts and deps"
node -e 'const p=require("./package.json");console.log(JSON.stringify({scripts:p.scripts,dependencies:p.dependencies,devDependencies:p.devDependencies},null,1))'
echo "-- package.json diff vs pre-T001 commit 48928ec:"; git --no-optional-locks diff 48928ec HEAD -- package.json
echo "-- README Disclosures mentions:"; for k in zod supabase-js Vitest; do printf "%s: " $k; grep -c "$k" README.md; done
echo; echo "### C2 folders"
for d in src/core/{registry,orchestrator,scoring,findings,fix,reports,security,llm,db} src/modules/chatbot/{attacks,judge,harden,demo-bot} src/modules/web_email src/mocks supabase/migrations eval; do printf "%-32s %s\n" "$d" "$(ls $d | tr '\n' ' ')"; done
for f in src/core/{registry,orchestrator,scoring,findings,fix,reports,db}/index.ts src/modules/chatbot/{judge,harden}/index.ts src/modules/chatbot/index.ts src/modules/web_email/index.ts eval/index.ts; do echo "$f: $(head -1 $f)"; done
echo; echo "### C3 type exports"
grep -hoE 'export (const|type|interface) [A-Za-z]+' src/lib/types/*.ts | awk '{print $3}' | tr '\n' ' '; echo
grep -nE '"breach", "pass", "error", "skipped"|"canary", "asset", "overlap", "llm", "rule", "none"' src/lib/types/*.ts
echo; echo "### C4 migration"
M=supabase/migrations/0001_init.sql
echo "create table: $(grep -ciE '^create table' $M)  enable rls: $(grep -ci 'enable row level security' $M)  create policy: $(grep -ci 'create policy' $M)  references: $(grep -ci 'references' $M)  create index: $(grep -ci 'create index' $M)"
grep -niE 'create table|share_slug|primary key \(key, day\)|create index' $M
echo; echo "### C5/C6 key exports"
grep -nE 'export (async )?function chat|AbortController|15_?000|temperature' src/core/llm/adapter.ts
grep -nE 'DEMO_PROTECTED_ASSETS|DEMO_SYSTEM_PROMPT' src/modules/chatbot/demo-bot/index.ts | head
echo; echo "### C7 library coverage"
node -e 'const l=require("./src/modules/chatbot/attacks/library.json");const a=Array.isArray(l)?l:l.attacks;const c=k=>a.reduce((m,x)=>(m[x[k]]=(m[x[k]]||0)+1,m),{});console.log("count",a.length,"unique ids",new Set(a.map(x=>x.id)).size);console.log("intents",JSON.stringify(c("intent")));console.log("techniques",JSON.stringify(c("technique")));console.log("needsReview",a.filter(x=>x.needsReview).map(x=>x.id).join(","));console.log("all have en/ur/roman_ur",a.every(x=>x.prompts&&x.prompts.en&&x.prompts.ur&&x.prompts.roman_ur))'
echo; echo "### C9/C10 security"
grep -nE 'randomBytes|base64url|httpOnly|secure|sameSite|sha256' src/core/security/owner.ts
grep -rln 'ssrf' src/app || echo "no route imports ssrf"
echo; echo "### C11 process.env reads"
grep -rn 'process\.env' src --include=*.ts | grep -v '\.test\.ts'
echo "-- .env* files in repo root (names only):"; ls -a | grep '^\.env'
echo; echo "### C12 env example keys and gitignore"
grep -oE '^[A-Z_]+=' .env.example | tr '\n' ' '; echo
git --no-optional-locks check-ignore -v --no-index .env.example .env.local || true
echo; echo "### C13 README headings"
grep -nE '^#{1,2} ' README.md; sed -n '1,4p' README.md
echo; echo "### Supabase URL outside .env.example (no output = none)"
grep -rniE 'https?://[a-z0-9.-]*supabase' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.ai . || echo "no matches"
