/**
 * A question main asks on a window before a change goes ahead. The pure module
 * that decides the change writes it; main only shows it.
 */
export interface Confirmation {
    message: string;
    detail: string;
    /** The label of the button that goes ahead. */
    button: string;
    /** True when going ahead replaces or removes something, which makes Cancel the default. */
    destructive: boolean;
}

/** Asks a Confirmation. Resolves true to go ahead. */
export type Confirm = (question: Confirmation) => Promise<boolean>;
