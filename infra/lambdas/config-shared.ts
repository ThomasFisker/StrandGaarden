import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export const CONFIG_PK = 'CONFIG';
export const CONFIG_SK = 'META';

export type Stage = 1 | 2 | 3;

export interface AppConfig {
  stage: Stage;
  maxBookSlotsPerHouse: number;
  maxHouseTextChars: number;
  gdprText: string;
  gdprVersion: string;
}

/** Initial Danish GDPR consent text — committee can edit on /admin/fase. */
export const DEFAULT_GDPR_TEXT = `Samtykke til billedbidrag — Strandgaarden 100 år

Tak fordi du bidrager til vores jubilæumsarkiv.

Inden du uploader billeder, beder vi dig læse og acceptere følgende:

Hvad bruger vi billederne til?
• Den trykte jubilæumsbog, der udgives i forbindelse med 100-års
  jubilæet i juni 2027.
• Eventuelt på Strandgaardens hjemmeside og i interne nyhedsbreve.

Hvad bekræfter du?
• At du har lov til at uploade billederne — du ejer dem, eller du
  har fået lov af ophavsmanden.
• At de personer der er tydeligt genkendelige på billederne, er
  indforståede med at billederne kan blive vist offentligt.

Hvad gør vi for at beskytte dig?
• Du kan altid bede udvalget fjerne et billede ved at klikke
  "Anmod om fjernelse" på billedets side.
• Vi gemmer ikke billederne længere end nødvendigt, og vi bruger
  dem ikke til andre formål uden at spørge dig først.

Klik "Accepter" for at bekræfte at du har læst og forstået
ovenstående.`;

export const DEFAULT_CONFIG: AppConfig = {
  stage: 3,
  maxBookSlotsPerHouse: 7,
  maxHouseTextChars: 900,
  gdprText: DEFAULT_GDPR_TEXT,
  gdprVersion: '2026-05-03',
};

const isStage = (n: unknown): n is Stage => n === 1 || n === 2 || n === 3;

/** Read the singleton config row, falling back to defaults for any missing
 * field. The row may be entirely absent until the first admin save. */
export const getConfig = async (
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<AppConfig> => {
  const r = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { PK: CONFIG_PK, SK: CONFIG_SK } }),
  );
  const it = r.Item;
  if (!it) return DEFAULT_CONFIG;
  return {
    stage: isStage(it.stage) ? it.stage : DEFAULT_CONFIG.stage,
    maxBookSlotsPerHouse:
      typeof it.maxBookSlotsPerHouse === 'number' && it.maxBookSlotsPerHouse > 0
        ? it.maxBookSlotsPerHouse
        : DEFAULT_CONFIG.maxBookSlotsPerHouse,
    maxHouseTextChars:
      typeof it.maxHouseTextChars === 'number' && it.maxHouseTextChars > 0
        ? it.maxHouseTextChars
        : DEFAULT_CONFIG.maxHouseTextChars,
    gdprText:
      typeof it.gdprText === 'string' && it.gdprText.length > 0
        ? it.gdprText
        : DEFAULT_CONFIG.gdprText,
    gdprVersion:
      typeof it.gdprVersion === 'string' && it.gdprVersion.length > 0
        ? it.gdprVersion
        : DEFAULT_CONFIG.gdprVersion,
  };
};
