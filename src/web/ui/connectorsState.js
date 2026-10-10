import React from 'react';
import { getConnectorsSnapshot, subscribeConnectors } from './engine.js';

/**
 * Live connector list: connectors register in the background after the UI
 * is shown, so `ready` tells whether the list is complete.
 */
export function useConnectors() {
    return React.useSyncExternalStore(subscribeConnectors, getConnectorsSnapshot);
}
