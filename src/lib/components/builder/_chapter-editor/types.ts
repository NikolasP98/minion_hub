export type FieldKey =
    | "name"
    | "description"
    | "triggerConditions"
    | "guide"
    | "context"
    | "outputDef"
    | "successCriteria";

export interface FieldConflict {
    userValue: string;
    aiValue: string;
}

export interface ChapterData {
    id: string;
    name: string;
    description: string;
    guide: string;
    context: string;
    outputDef: string;
}

export type AiFieldName = 'description' | 'guide' | 'context' | 'outputDef';
