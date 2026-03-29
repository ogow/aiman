export class UserError extends Error {
   constructor(message: string) {
      super(message);
      this.name = "UserError";
   }
}

export function hasErrorCode(
   error: unknown,
   code: string
): error is NodeJS.ErrnoException {
   return error instanceof Error && "code" in error && error.code === code;
}
