/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/merchant_directory.json`.
 */
export type MerchantDirectory = {
  "address": "wRjcJxHLmDiStxUv5hhg4m3EZKnywZcBQj1W27unSHZ",
  "metadata": {
    "name": "merchantDirectory",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "MerchantDirectory — thin local index of merchant agents.",
    "",
    "This program is only a discovery index (endpoint URI, geohash, category).",
    "It does not attempt to verify merchant identity on its own; if an",
    "external agent identity/reputation registry is wired up later, treat",
    "that registry as the source of truth and `agent_id` here as just a",
    "pointer into it."
  ],
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "directoryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  114,
                  101,
                  99,
                  116,
                  111,
                  114,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "listMerchant",
      "discriminator": [
        57,
        78,
        149,
        223,
        182,
        150,
        239,
        46
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "directoryState"
          ]
        },
        {
          "name": "directoryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  114,
                  101,
                  99,
                  116,
                  111,
                  114,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "merchantId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "merchantId",
          "type": "u64"
        },
        {
          "name": "agentId",
          "type": "u64"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "category",
          "type": "string"
        },
        {
          "name": "endpointUri",
          "type": "string"
        },
        {
          "name": "wallet",
          "type": "pubkey"
        },
        {
          "name": "geoHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "attestationUid",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setActive",
      "discriminator": [
        29,
        16,
        225,
        132,
        38,
        216,
        206,
        33
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "directoryState"
          ]
        },
        {
          "name": "directoryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  114,
                  101,
                  99,
                  116,
                  111,
                  114,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "merchant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "merchantId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "merchantId",
          "type": "u64"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "directoryState",
      "discriminator": [
        114,
        2,
        131,
        39,
        196,
        130,
        99,
        177
      ]
    },
    {
      "name": "merchant",
      "discriminator": [
        71,
        235,
        30,
        40,
        231,
        21,
        32,
        64
      ]
    }
  ],
  "events": [
    {
      "name": "merchantActiveSet",
      "discriminator": [
        252,
        209,
        236,
        88,
        6,
        112,
        150,
        190
      ]
    },
    {
      "name": "merchantListed",
      "discriminator": [
        193,
        227,
        74,
        247,
        178,
        223,
        122,
        187
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the directory authority can perform this action"
    },
    {
      "code": 6001,
      "name": "merchantIdMismatch",
      "msg": "merchant_id does not match the directory's next_merchant_id"
    },
    {
      "code": 6002,
      "name": "overflow",
      "msg": "merchant id counter overflowed"
    },
    {
      "code": 6003,
      "name": "nameTooLong",
      "msg": "name exceeds the maximum length"
    },
    {
      "code": 6004,
      "name": "categoryTooLong",
      "msg": "category exceeds the maximum length"
    },
    {
      "code": 6005,
      "name": "endpointUriTooLong",
      "msg": "endpoint URI exceeds the maximum length"
    }
  ],
  "types": [
    {
      "name": "directoryState",
      "docs": [
        "Workspace singleton: who may list/activate merchants, and the next merchant id to hand out."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "nextMerchantId",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "merchant",
      "docs": [
        "Thin local index of a merchant agent, one PDA per merchant id.",
        "",
        "`agent_id` is a pointer into an external agent identity registry, if one",
        "is ever wired up — this account is only a discovery index (endpoint,",
        "geohash, category). Do not treat it as verified identity on its own."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "agentId",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "category",
            "type": "string"
          },
          {
            "name": "endpointUri",
            "type": "string"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "geoHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "attestationUid",
            "docs": [
              "Off-chain attestation reference (e.g. an EAS-style UID), if any. Zeroed when absent."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "merchantActiveSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "merchantListed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "agentId",
            "type": "u64"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "directoryStateSeed",
      "type": "bytes",
      "value": "[100, 105, 114, 101, 99, 116, 111, 114, 121, 95, 115, 116, 97, 116, 101]"
    },
    {
      "name": "merchantSeed",
      "type": "bytes",
      "value": "[109, 101, 114, 99, 104, 97, 110, 116]"
    }
  ]
};
