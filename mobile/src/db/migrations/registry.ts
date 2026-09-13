/**
 * Canonical SHA-256 Checksum Registry for all immutable migrations.
 * Moving this registry here ensures future migrations do not require editing older migration files.
 */
export const CANONICAL_MIGRATION_CHECKSUMS: Record<number, string> = {
  1: '3401108a03c501e234c0bbee51f6817110ce1e67942561d1d5ecfa6ae2f0a3a7',
  2: 'd68c734ca7da2d4991918ac6941402382995987be06ab2b606a7446451b0dbd5',
  3: 'ae389f82651e5e44ebf6e561e3a6da77802a217f7ad87736f1a6a3bbf7bf3bb9',
  4: 'c2cbb8c3794dbb5879a5ab83321411d63f686fda31036ff44aeff068309d9d9b',
  5: '0d94b86ce2c88b3cde228624342bac28742a96c5dea7eecea735907c832585bd',
  6: 'fa2d22a9ebf7d7f180f95be7d3714417d9f7554fb10d2220b3bde77342f3407f',
  7: 'accc5797631eb3e0a89c857cf871a0eac7b11b8966a6eba92b5070ce823ed882',
};
