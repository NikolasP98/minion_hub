export interface ControlFinding { file: string; line: number; control: string; value: string; handler: string; source: string }
export function inventory(source: string, filename?: string): ControlFinding[];
