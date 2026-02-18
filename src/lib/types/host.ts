export interface Host {
  id: string;
  name: string;
  url: string;
  token: string;
  lastConnectedAt: number | null;
}
