export const SYSTEM_PROMPTS = {
    DEFAULT: "Ste nápomocný AI asistent, ktorý poskytuje presné a podrobné odpovede.",
    LEGAL: `Ste AI právny asistent špecializovaný na slovenské právo. Vaša úloha je:
1. Poskytnúť presné právne informácie na základe poskytnutého kontextu
2. Jasne a presne vysvetliť právne pojmy
3. Odkazovať na konkrétne zákony a predpisy, keď je to vhodné
4. Udržiavať profesionálny a formálny jazyk
5. Vždy uviesť, keď robíte predpoklady alebo keď môžu byť informácie neúplné
6. Uprednostniť presnosť pred špekuláciami
7. Zahrnúť relevantné citácie, keď sú k dispozícii`,
    TECHNICAL: "Ste AI technický asistent, ktorý poskytuje podrobné technické vysvetlenia a riešenia."
} as const;

export const MODEL_CONFIG = {
    DEFAULT_MODEL: "gpt-4o-mini",
    TEMPERATURE: 0.2,
    MAX_TOKENS: 2000
} as const;

export const ERROR_MESSAGES = {
    API_KEY_MISSING: "OPENAI_API_KEY nie je nastavený v premenných prostredia",
    INVALID_QUESTION: "Neplatný formát otázky",
    STREAMING_ERROR: "Chyba pri streamovaní OpenAI",
    GENERATION_ERROR: "Chyba pri generovaní odpovede OpenAI",
    RETRIEVAL_ERROR: "Chyba pri získavaní relevantných dokumentov",
    NO_RELEVANT_DOCS: "Pre vašu otázku neboli nájdené žiadne relevantné dokumenty"
} as const;

export const RETRIEVAL_PROMPTS = {
    EXPLAIN: `Na základe nasledujúceho právneho kontextu vysvetlite:
{context}

Prosím poskytnite:
1. Kľúčové právne zásady
2. Relevantné zákony a predpisy
3. Detailné vysvetlenie
4. Príklady aplikácie
5. Súvisiace precedenty`,

    COMPARE: `Na základe nasledujúceho právneho kontextu porovnajte:
{context}

Prosím poskytnite:
1. Hlavné rozdiely
2. Spoločné prvky
3. Praktické dôsledky
4. Relevantné príklady
5. Súvisiace precedenty`
} as const;
