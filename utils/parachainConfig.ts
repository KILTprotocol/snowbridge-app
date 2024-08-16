interface Destination {
  parents: number;
  interior: {
    X1: {
      Parachain: number;
    };
  };
}

interface Entry {
  name: string;
  endpoint: string;
  pallet: string;
  destination: Destination;
  parachainId: number;
}

interface ParaConfig {
  [key: string]: Entry;
}

export const parachainConfig: ParaConfig = {
  Kilt: {
    name: "Kilt",
    endpoint: "wss://kilt.dotters.network",
    pallet: "assetSwitchPool1",
    parachainId: 2086,
    destination: {
      parents: 1,
      interior: {
        X1: {
          Parachain: 2086,
        },
      },
    },
  },
  Rilt: {
    name: "Rilt",
    endpoint: "wss://rilt.kilt.io",
    pallet: "assetSwitchPool1",
    parachainId: 4504,
    destination: {
      parents: 1,
      interior: {
        X1: {
          Parachain: 4504,
        },
      },
    },
  },
};
