/** A user-facing problem with arguments or input. `exitCode` is for the CLI. */
export class InputError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'InputError';
    this.exitCode = exitCode;
  }
}
