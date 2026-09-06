import type { ZanarisApi } from '../shared/ipc';

declare global {
    interface Window {
        zanaris: ZanarisApi;
    }
}
