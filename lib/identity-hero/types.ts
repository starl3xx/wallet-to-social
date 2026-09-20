import { z } from 'zod';

const address = z.string().regex(/^0x[a-f0-9]{40}$/);
const handle = z.string().regex(/^[a-zA-Z0-9_]{1,15}$/);
export const heroSnapshotSchema = z.object({
  version: z.literal(1),
  checkedAt: z.string().datetime(),
  accounts: z
    .array(
      z.object({
        id: z.enum([
          'jesse',
          'vitalik',
          'dan',
          'varun',
          'linda',
          'jacob',
          'ted',
          'seneca',
          'coop',
          'tim',
          'balaji',
        ]),
        name: z.string().max(100),
        fid: z.number().int().positive(),
        handle,
        fc: z.string().regex(/^[a-zA-Z0-9.-]+$/),
        wallet: address,
        xVerified: z.boolean(),
        xPhoto: z
          .string()
          .max(50000)
          .regex(
            /^(?:data:image\/webp;base64,[A-Za-z0-9+/=]+|\/hero\/[a-z0-9-]+\.webp)$/
          )
          .nullable(),
        checkedAt: z.string().datetime(),
        wallets: z
          .array(
            z.object({
              address,
              evidence: z.string().max(100),
              xAttested: z.boolean(),
            })
          )
          .min(1)
          .max(32),
      })
    )
    .max(8),
  sample: z
    .object({
      rows: z
        .array(
          z.object({
            address,
            handle: handle.nullable(),
            xAttested: z.boolean(),
            synthetic: z.boolean(),
          })
        )
        .length(5),
    })
    .nullable(),
});
export type HeroSnapshot = z.infer<typeof heroSnapshotSchema>;
