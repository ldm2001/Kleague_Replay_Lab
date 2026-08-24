export type Migration = {
  name: string;
  sql: string;
  checksum: string;
};

export const loadMigrations: () => Promise<Migration[]>;
