/**
 * Shared prompt fragments reused across actions so the same instruction
 * lands verbatim everywhere it matters. Keep these tiny and composable —
 * single source of truth for cross-cutting prompt rules.
 */

/**
 * Domain-idiomatic terminology rule. The host injects user language at
 * the action layer ("respond in Russian", "answer in English", etc.) —
 * this fragment ensures that translated technical writing uses the
 * loanwords / anglicisms / community conventions a native speaker would
 * actually use, not literal dictionary translations.
 *
 * The agent is told: prefer "легаси код" over "наследие-код",
 * "фронтенд" over "передний-конец", "пайплайн" over "трубопровод"
 * when those are the conventional Russian renderings in tech writing.
 * Same principle for any language pair.
 */
export const TERMINOLOGY_RULE = [
  "## Terminology — domain-idiomatic, not literal",
  "Use the wording native speakers actually use in this domain, even when it's a borrowed word.",
  "Prefer established loanwords/anglicisms over literal translations whenever that's the conventional choice in the field.",
  "Examples (Russian, for tech topics):",
  "  - 'легаси код', not 'наследие-код'",
  "  - 'фронтенд' / 'бэкенд', not 'передний-конец' / 'задний-конец'",
  "  - 'дедлайн', not 'крайний срок' (when context is software/work)",
  "  - 'фреймворк', not 'каркас'",
  "  - 'деплой', 'мерж', 'пуш', 'пайплайн', 'тред', 'юнит-тест', 'хук', 'фича-флаг', 'рефакторинг'",
  "The same principle applies to every language: pick what readers in that field actually say, not what a dictionary suggests.",
  "Translate idiomatically. Never invent calques.",
].join("\n");
