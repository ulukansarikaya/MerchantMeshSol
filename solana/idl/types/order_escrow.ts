/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/order_escrow.json`.
 */
export type OrderEscrow = {
  "address": "3M8mUguDLdnvPqvVE9KYp11MfkTcGYCo8UhnVqoCCCuV",
  "metadata": {
    "name": "orderEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "OrderEscrow — pickup-code released escrow for MerchantMesh orders.",
    "",
    "The buyer's agent funds one escrow (a per-order SPL token vault PDA) per",
    "merchant order. The merchant releases it by submitting the buyer's",
    "one-time pickup code (`keccak256(code)` must match the stored hash).",
    "Manual `user_release` exists only as a fallback; timeouts drive automatic",
    "refunds via `refund`."
  ],
  "instructions": [
    {
      "name": "confirmPickup",
      "discriminator": [
        37,
        5,
        149,
        215,
        41,
        79,
        248,
        82
      ],
      "accounts": [
        {
          "name": "merchant",
          "signer": true
        },
        {
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "merchantTokenAccount",
          "writable": true
        },
        {
          "name": "buyer",
          "docs": [
            "Order's buyer — receives the vault's reclaimed rent once it is closed."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "code",
          "type": "string"
        }
      ]
    },
    {
      "name": "dispute",
      "discriminator": [
        216,
        92,
        128,
        146,
        202,
        85,
        135,
        73
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fund",
      "discriminator": [
        218,
        188,
        111,
        221,
        152,
        113,
        174,
        7
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "escrowConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
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
          "name": "merchantWallet",
          "docs": [
            "Existence of this PDA is the \"merchant is registered\" gate — mirrors",
            "OrderEscrow.sol's `merchantWallets[merchantId] != address(0)` check."
          ],
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "buyerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "quoteHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "pickupCodeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "releaseDeadline",
          "type": "i64"
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
          "name": "escrowConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
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
          "name": "arbiter",
          "type": "pubkey"
        },
        {
          "name": "usdcMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "markPreparing",
      "discriminator": [
        222,
        92,
        150,
        73,
        7,
        54,
        143,
        177
      ],
      "accounts": [
        {
          "name": "merchant",
          "signer": true
        },
        {
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "markReady",
      "discriminator": [
        12,
        90,
        62,
        28,
        65,
        49,
        62,
        228
      ],
      "accounts": [
        {
          "name": "merchant",
          "signer": true
        },
        {
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Anyone may call this once the deadline has passed; only the buyer may",
            "call it earlier (pre-Preparing cancel) — enforced in the handler."
          ],
          "signer": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "buyerTokenAccount",
          "writable": true
        },
        {
          "name": "buyer",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolve",
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "arbiter",
          "signer": true
        },
        {
          "name": "escrowConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
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
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "buyerTokenAccount",
          "writable": true
        },
        {
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        },
        {
          "name": "merchantTokenAccount",
          "writable": true
        },
        {
          "name": "buyer",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "releaseToMerchant",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setMerchantWallet",
      "discriminator": [
        37,
        95,
        229,
        162,
        65,
        5,
        100,
        151
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "escrowConfig"
          ]
        },
        {
          "name": "escrowConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
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
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
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
          "name": "wallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setUsdcMint",
      "discriminator": [
        134,
        188,
        41,
        199,
        126,
        105,
        241,
        157
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "escrowConfig"
          ]
        },
        {
          "name": "escrowConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
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
          "name": "usdcMint",
          "docs": [
            "Requiring a decoded SPL Mint prevents configuring an arbitrary address."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "userRelease",
      "discriminator": [
        68,
        17,
        112,
        160,
        29,
        11,
        23,
        202
      ],
      "accounts": [
        {
          "name": "buyer",
          "signer": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "merchantWallet",
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
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "merchantWallet.merchantId",
                "account": "merchantWallet"
              }
            ]
          }
        },
        {
          "name": "merchantTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "escrowConfig",
      "discriminator": [
        138,
        174,
        227,
        187,
        239,
        148,
        1,
        44
      ]
    },
    {
      "name": "merchantWallet",
      "discriminator": [
        198,
        157,
        138,
        39,
        42,
        95,
        177,
        208
      ]
    },
    {
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    }
  ],
  "events": [
    {
      "name": "disputeResolved",
      "discriminator": [
        121,
        64,
        249,
        153,
        139,
        128,
        236,
        187
      ]
    },
    {
      "name": "merchantWalletSet",
      "discriminator": [
        132,
        178,
        39,
        171,
        12,
        51,
        99,
        241
      ]
    },
    {
      "name": "orderDisputed",
      "discriminator": [
        186,
        104,
        120,
        36,
        95,
        130,
        173,
        128
      ]
    },
    {
      "name": "orderFunded",
      "discriminator": [
        33,
        168,
        21,
        171,
        46,
        9,
        84,
        49
      ]
    },
    {
      "name": "orderPreparing",
      "discriminator": [
        20,
        61,
        183,
        63,
        128,
        87,
        237,
        222
      ]
    },
    {
      "name": "orderReady",
      "discriminator": [
        79,
        59,
        233,
        222,
        122,
        150,
        232,
        250
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
      "name": "orderReleased",
      "discriminator": [
        171,
        232,
        93,
        217,
        184,
        222,
        234,
        29
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "only the escrow authority can perform this action"
    },
    {
      "code": 6001,
      "name": "notArbiter",
      "msg": "only the escrow arbiter can perform this action"
    },
    {
      "code": 6002,
      "name": "orderIdMismatch",
      "msg": "order_id does not match escrow_config.next_order_id"
    },
    {
      "code": 6003,
      "name": "overflow",
      "msg": "order id counter overflowed"
    },
    {
      "code": 6004,
      "name": "zeroAmount",
      "msg": "amount must be greater than zero"
    },
    {
      "code": 6005,
      "name": "deadlineInPast",
      "msg": "release_deadline must be in the future"
    },
    {
      "code": 6006,
      "name": "wrongState",
      "msg": "order is not in the required state for this action"
    },
    {
      "code": 6007,
      "name": "notBuyer",
      "msg": "only the order's buyer can perform this action"
    },
    {
      "code": 6008,
      "name": "notMerchant",
      "msg": "only the order's merchant wallet can perform this action"
    },
    {
      "code": 6009,
      "name": "wrongPickupCode",
      "msg": "pickup code does not match the stored hash"
    },
    {
      "code": 6010,
      "name": "refundNotAllowed",
      "msg": "refund is only allowed pre-Preparing (buyer) or past the release deadline (anyone)"
    },
    {
      "code": 6011,
      "name": "wrongTokenAccountOwner",
      "msg": "destination token account owner does not match the expected wallet"
    },
    {
      "code": 6012,
      "name": "wrongTokenAccountMint",
      "msg": "destination token account mint does not match the vault's mint"
    }
  ],
  "types": [
    {
      "name": "disputeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "releasedToMerchant",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "escrowConfig",
      "docs": [
        "Workspace singleton: admin authority, dispute arbiter, the USDC (or other",
        "SPL) mint this escrow accepts, and the next order id to hand out."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "arbiter",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "nextOrderId",
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
      "name": "merchantWallet",
      "docs": [
        "merchant_id -> payout wallet, set by the admin. Independent of the",
        "MerchantDirectory program — this escrow does not read that directory,",
        "exactly like the original OrderEscrow.sol kept its own wallet mapping."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "merchantWalletSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "order",
      "docs": [
        "One escrowed order. The vault (a separate token account PDA, seeds",
        "[VAULT_SEED, order_id]) holds the funds; this account's own address is",
        "the vault's token authority, so releases/refunds sign the outgoing",
        "transfer with the order's own PDA seeds."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "quoteHash",
            "docs": [
              "Hash of the merchant's signed quote (opaque to this program)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pickupCodeHash",
            "docs": [
              "keccak256(one-time pickup code); only the hash is ever stored on-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "fundedAt",
            "type": "i64"
          },
          {
            "name": "releaseDeadline",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "orderState"
              }
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
      "name": "orderDisputed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "orderFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "merchantId",
            "type": "u64"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "quoteHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "orderPreparing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderReady",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
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
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderReleased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "funded"
          },
          {
            "name": "preparing"
          },
          {
            "name": "ready"
          },
          {
            "name": "released"
          },
          {
            "name": "refunded"
          },
          {
            "name": "disputed"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "escrowConfigSeed",
      "type": "bytes",
      "value": "[101, 115, 99, 114, 111, 119, 95, 99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "merchantWalletSeed",
      "type": "bytes",
      "value": "[109, 101, 114, 99, 104, 97, 110, 116, 95, 119, 97, 108, 108, 101, 116]"
    },
    {
      "name": "orderSeed",
      "type": "bytes",
      "value": "[111, 114, 100, 101, 114]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
