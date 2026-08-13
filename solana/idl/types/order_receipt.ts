/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/order_receipt.json`.
 */
export type OrderReceipt = {
  "address": "B5htcm88nzRtNyfHMyhh7SQ5pHudw1dMx6Ean5xP2wsm",
  "metadata": {
    "name": "orderReceipt",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "OrderReceipt — unified on-chain receipt for a shopping task.",
    "",
    "Written by the relayer after settlement: research micro-spend, main",
    "payment total, completed/total items, and a hash of the off-chain",
    "receipt metadata."
  ],
  "instructions": [
    {
      "name": "createReceipt",
      "discriminator": [
        187,
        57,
        104,
        13,
        15,
        1,
        219,
        99
      ],
      "accounts": [
        {
          "name": "relayer",
          "writable": true,
          "signer": true
        },
        {
          "name": "receiptConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "receiptId"
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
          "name": "receiptId",
          "type": "u64"
        },
        {
          "name": "taskRef",
          "type": "string"
        },
        {
          "name": "totalResearchMicroUsdc",
          "type": "u64"
        },
        {
          "name": "totalMainMicroUsdc",
          "type": "u64"
        },
        {
          "name": "completedItems",
          "type": "u64"
        },
        {
          "name": "totalItems",
          "type": "u64"
        },
        {
          "name": "metadataUri",
          "type": "string"
        },
        {
          "name": "metadataHash",
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
          "name": "receiptConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
      "args": [
        {
          "name": "relayer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "recordRefund",
      "discriminator": [
        115,
        222,
        234,
        70,
        160,
        182,
        220,
        149
      ],
      "accounts": [
        {
          "name": "relayer",
          "signer": true
        },
        {
          "name": "receiptConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "receipt",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "receiptId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "receiptId",
          "type": "u64"
        },
        {
          "name": "refundedMicroUsdc",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    },
    {
      "name": "receiptConfig",
      "discriminator": [
        201,
        194,
        109,
        67,
        80,
        248,
        139,
        45
      ]
    }
  ],
  "events": [
    {
      "name": "mainPaymentRecorded",
      "discriminator": [
        2,
        180,
        132,
        3,
        47,
        215,
        6,
        132
      ]
    },
    {
      "name": "microSpendRecorded",
      "discriminator": [
        178,
        34,
        24,
        149,
        146,
        131,
        59,
        18
      ]
    },
    {
      "name": "orderRefunded",
      "discriminator": [
        120,
        155,
        10,
        169,
        7,
        98,
        202,
        187
      ]
    },
    {
      "name": "receiptCreated",
      "discriminator": [
        53,
        236,
        206,
        24,
        194,
        10,
        208,
        163
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "only the receipt relayer can perform this action"
    },
    {
      "code": 6001,
      "name": "receiptIdMismatch",
      "msg": "receipt_id does not match receipt_config.next_receipt_id"
    },
    {
      "code": 6002,
      "name": "overflow",
      "msg": "receipt id counter overflowed"
    },
    {
      "code": 6003,
      "name": "taskRefTooLong",
      "msg": "task_ref exceeds the maximum length"
    },
    {
      "code": 6004,
      "name": "metadataUriTooLong",
      "msg": "metadata_uri exceeds the maximum length"
    }
  ],
  "types": [
    {
      "name": "mainPaymentRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receiptId",
            "type": "u64"
          },
          {
            "name": "totalMainMicroUsdc",
            "type": "u64"
          },
          {
            "name": "completedItems",
            "type": "u64"
          },
          {
            "name": "totalItems",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "microSpendRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receiptId",
            "type": "u64"
          },
          {
            "name": "totalResearchMicroUsdc",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receiptId",
            "type": "u64"
          },
          {
            "name": "taskRef",
            "type": "string"
          },
          {
            "name": "refundedMicroUsdc",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "receipt",
      "docs": [
        "Unified on-chain receipt for a shopping task, written by the relayer",
        "after settlement: research micro-spend, main payment total,",
        "completed/total items, and a hash of the off-chain receipt metadata."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receiptId",
            "type": "u64"
          },
          {
            "name": "taskRef",
            "type": "string"
          },
          {
            "name": "totalResearchMicroUsdc",
            "type": "u64"
          },
          {
            "name": "totalMainMicroUsdc",
            "type": "u64"
          },
          {
            "name": "completedItems",
            "type": "u64"
          },
          {
            "name": "totalItems",
            "type": "u64"
          },
          {
            "name": "metadataUri",
            "type": "string"
          },
          {
            "name": "metadataHash",
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
      "name": "receiptConfig",
      "docs": [
        "Workspace singleton: admin authority, the relayer that writes receipts,",
        "and the next receipt id to hand out."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "type": "pubkey"
          },
          {
            "name": "nextReceiptId",
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
      "name": "receiptCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receiptId",
            "type": "u64"
          },
          {
            "name": "taskRef",
            "type": "string"
          },
          {
            "name": "metadataHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "receiptConfigSeed",
      "type": "bytes",
      "value": "[114, 101, 99, 101, 105, 112, 116, 95, 99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "receiptSeed",
      "type": "bytes",
      "value": "[114, 101, 99, 101, 105, 112, 116]"
    }
  ]
};
