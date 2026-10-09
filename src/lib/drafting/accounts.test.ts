import { describe, expect, it } from 'vitest';
import { suggestAccount, type AccountOption } from './accounts';

/** Loomi's real dealer names, 2026-10-09, trimmed to the ones that make it hard. */
const ACCOUNTS: AccountOption[] = [
  { key: 'audiLayton', dealer: 'Audi Layton' },
  { key: 'genesisOgden', dealer: 'Genesis Ogden' },
  { key: 'youngAutomotiveGroup', dealer: 'Young Automotive Group', isGroup: true },
  { key: 'youngBuickGmcOfLayton', dealer: 'Young Buick GMC Layton' },
  { key: 'youngChryslerDodgeJeepRamOfMorgan', dealer: 'Young Chrysler Dodge Jeep Ram of Morgan' },
  { key: 'youngChryslerDodgeJeepRamOfRiverdale', dealer: 'Young Chrysler Dodge Jeep Ram of Riverdale' },
  { key: 'youngChryslerDodgeJeepRamOfLayton', dealer: 'Young Chrysler Jeep Dodge Ram of Layton' },
  { key: 'youngFordOfBrigham', dealer: 'Young Ford of Brigham' },
  { key: 'youngGrandTetonHarleyDavidson', dealer: 'Young Grand Teton Harley-Davidson' },
  { key: 'youngGrizzlyHarleyDavidson', dealer: 'Young Grizzly Harley Davidson' },
  { key: 'youngMazdaOfIdahoFalls', dealer: 'Young Mazda of Idaho Falls' },
  { key: 'youngMazdaOfMissoula', dealer: 'Young Mazda of Missoula' },
  { key: 'youngMazdaOfOgden', dealer: 'Young Mazda of Ogden' },
  { key: 'youngNissan', dealer: 'Young Nissan' },
  { key: 'youngPowersports', dealer: 'Young Powersports', isGroup: true },
  { key: 'youngPowersportsEuro', dealer: 'Young Powersports Euro' },
  { key: 'youngPowersportsOfOgden', dealer: 'Young Powersports of Ogden' },
  { key: 'youngPowersportsXl', dealer: 'Young Powersports XL' },
  { key: 'youngTruckAndTrailerOfKaysville', dealer: 'Young Truck & Trailer of Kaysville' },
  { key: 'youngUsedCenter', dealer: 'Young Used Center' },
];

const suggest = (label: string) => suggestAccount(label, ACCOUNTS).accountKey;

describe('suggestAccount — monday Client labels against Loomi dealer names', () => {
  it('matches despite word order, "in"/"of", punctuation and "&"', () => {
    expect(suggest('Young Chrysler Jeep Dodge Ram in Morgan')).toBe('youngChryslerDodgeJeepRamOfMorgan');
    expect(suggest('Young Buick GMC (Layton)')).toBe('youngBuickGmcOfLayton');
    expect(suggest('Young Ford Brigham')).toBe('youngFordOfBrigham');
    expect(suggest('Young Truck and Trailer Kaysville')).toBe('youngTruckAndTrailerOfKaysville');
  });

  it('matches when one name is the other plus a word', () => {
    expect(suggest('Young Audi')).toBe('audiLayton');
    expect(suggest('Young Genesis')).toBe('genesisOgden');
    expect(suggest('Young Mazda Idaho')).toBe('youngMazdaOfIdahoFalls');
    expect(suggest('Young Nissan Riverdale')).toBe('youngNissan');
    expect(suggest('Young Used Car Center')).toBe('youngUsedCenter');
    expect(suggest('Young Automotive Group (YAG)')).toBe('youngAutomotiveGroup');
  });

  it('prefers the store over the group that contains it', () => {
    expect(suggest('Young Powersports Ogden')).toBe('youngPowersportsOfOgden');
    expect(suggest('Young Powersports Centerville XL')).toBe('youngPowersportsXl');
    expect(suggest('Young Powersports ALL')).toBe('youngPowersports');
  });

  it('says nothing rather than guess', () => {
    // Three Mazda stores; two Harley stores.
    expect(suggestAccount('Young Mazda', ACCOUNTS)).toEqual({
      accountKey: null,
      reason: '"Young Mazda" could be more than one account.',
    });
    expect(suggest('Young Harley Davidson')).toBeNull();
    // No Burley store in Loomi — sharing four of five words with Morgan isn't enough.
    expect(suggest('Young Chrysler Dodge Jeep Ram of Burley')).toBeNull();
    // Contains "Young Powersports" — but that's the group, and this names a store.
    expect(suggest('Young Powersports Bountiful/Centerville')).toBeNull();
  });

  it('matches each store on a multi-store request on its own', () => {
    // Two clients on one request, each with its own templates.
    expect(['Young Powersports Ogden', 'Young Powersports Euro'].map(suggest)).toEqual([
      'youngPowersportsOfOgden',
      'youngPowersportsEuro',
    ]);
  });
});
