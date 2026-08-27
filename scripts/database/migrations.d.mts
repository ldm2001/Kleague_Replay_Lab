export type Migration = {
  name: string;
  sql: string;
  checksum: string;
};

export const migrations: () => Promise<Migration[]>;
