import type { SwiftkitApi } from '../shared/ipc';

declare global {
    interface Window {
        swiftkit: SwiftkitApi;
    }
}
