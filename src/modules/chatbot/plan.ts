import { INTENTS, LANGS, type AttackDefinition, type Lang, type Level, type ScanSize, type Step, type Technique } from "@/lib/types";
import { getAttack, getAttackLibrary } from "./attacks";

/**
 * Scan plan for the chatbot module. Deterministic: same input, same steps.
 * - Attacks are taken round-robin over the 5 intents, so consecutive steps have different intents.
 * - quick: 2 attacks per intent (10), chosen to spread techniques: least-used technique first, then
 *   attacks without needsReview, then library order. full: every attack (20).
 * - Each attack runs in all 3 languages: pass r gives attack j the language LANGS[(j + r * shift) % 3].
 *   shift (1 or 2) is chosen from the attack count so consecutive steps differ in language,
 *   also across the boundary between two passes.
 */

export const QUICK_ATTACKS_PER_INTENT = 2;

function byIntent(library: AttackDefinition[]): AttackDefinition[][] {
  return INTENTS.map((intent) => library.filter((a) => a.intent === intent));
}

/** Attack order for a scan size: round-robin over intents. */
export function selectAttacks(size: ScanSize, library: AttackDefinition[] = getAttackLibrary()): AttackDefinition[] {
  const groups = byIntent(library);
  const rounds = size === "quick" ? QUICK_ATTACKS_PER_INTENT : Math.max(...groups.map((g) => g.length));
  const used = new Set<string>();
  const techniqueUse = new Map<Technique, number>();
  const order: AttackDefinition[] = [];

  for (let round = 0; round < rounds; round++) {
    for (const group of groups) {
      const candidates = group.filter((a) => !used.has(a.id));
      if (candidates.length === 0) continue;
      const pick =
        size === "full"
          ? candidates[0]
          : [...candidates].sort(
              (a, b) =>
                (techniqueUse.get(a.technique) ?? 0) - (techniqueUse.get(b.technique) ?? 0) ||
                Number(a.needsReview ?? false) - Number(b.needsReview ?? false) ||
                library.indexOf(a) - library.indexOf(b),
            )[0];
      used.add(pick.id);
      techniqueUse.set(pick.technique, (techniqueUse.get(pick.technique) ?? 0) + 1);
      order.push(pick);
    }
  }
  return order;
}

export function checkIdOf(attackId: string, lang: Lang): string {
  return `${attackId}:${lang}`;
}

/** Parses "A01:en" into its attack and language, or null when unknown. */
export function parseCheckId(checkId: string): { attack: AttackDefinition; lang: Lang } | null {
  const match = /^(A\d{2}):(en|ur|roman_ur)$/.exec(checkId);
  if (!match) return null;
  const attack = getAttack(match[1]);
  return attack ? { attack, lang: match[2] as Lang } : null;
}

export function planChatbotScan(size: ScanSize, level: Level): Step[] {
  const attacks = selectAttacks(size);
  const n = LANGS.length;
  const shift = attacks.length % n === 2 ? 2 : 1;
  const steps: Step[] = [];
  for (let pass = 0; pass < n; pass++) {
    attacks.forEach((attack, j) => {
      const lang = LANGS[(j + pass * shift) % n];
      const index = steps.length;
      const checkId = checkIdOf(attack.id, lang);
      steps.push({
        id: checkId,
        index,
        module: "chatbot",
        checkId,
        level,
        lang,
        intent: attack.intent,
        technique: attack.technique,
      });
    });
  }
  return steps;
}
