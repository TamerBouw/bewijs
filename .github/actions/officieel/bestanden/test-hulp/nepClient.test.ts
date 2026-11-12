/**
 * Zelftest van de nep-client (voor beheerders). Draait mee met `npm test`, niet in het testbewijs.
 */
import { describe, expect, it } from 'vitest';
import { NepApiFout, jsonAntwoord, maakNepClient, tekstAntwoord, toolAntwoord } from './nepClient';

const basis = { max_tokens: 100, messages: [{ role: 'user' as const, content: 'Hallo' }] };
const tool = {
  name: 'classificeer',
  description: 'test',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: { categorie: { type: 'string' } },
    required: ['categorie'],
    additionalProperties: false,
  },
};

describe('nep-client', () => {
  it('geeft gescripte antwoorden terug en bewaart de params', async () => {
    const client = maakNepClient([tekstAntwoord('Eén'), toolAntwoord('classificeer', { categorie: 'x' }, 'toolu_1')]);
    const a = await client.messages.create({ ...basis, model: 'claude-haiku-5-5' });
    expect(a.content[0]).toMatchObject({ type: 'text', text: 'Eén' });
    expect(a.stop_reason).toBe('end_turn');
    const b = await client.messages.create({ ...basis, model: 'claude-haiku-5-5', tools: [tool] });
    expect(b.stop_reason).toBe('tool_use');
    expect(b.content[0]).toMatchObject({ type: 'tool_use', id: 'toolu_1', name: 'classificeer' });
    expect(client.aantalAanroepen).toBe(2);
    expect(client.aanroepen[1].tools).toHaveLength(1);
  });

  it('weigert geforceerde tool use op Opus 5.5, Sonnet 5.5, Fable 5.1 en Mythos 5.1', async () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
      for (const tool_choice of [{ type: 'tool' as const, name: 'classificeer' }, { type: 'any' as const }]) {
        const client = maakNepClient([jsonAntwoord({})]);
        const belofte = client.messages.create({ ...basis, model, tools: [tool], tool_choice });
        await expect(belofte).rejects.toThrow(NepApiFout);
        await expect(
          maakNepClient().messages.create({ ...basis, model, tools: [tool], tool_choice }),
        ).rejects.toThrow(/geen geforceerde tool use.*tool_choice auto met strict: true, of output_config\.format/);
      }
      const auto = maakNepClient([tekstAntwoord('ok')]);
      await expect(auto.messages.create({ ...basis, model, tools: [tool], tool_choice: { type: 'auto' } })).resolves.toBeTruthy();
    }
  });

  it('staat geforceerde tool use toe op Haiku 5.5', async () => {
    const client = maakNepClient([toolAntwoord('classificeer', { categorie: 'x' })]);
    await expect(
      client.messages.create({ ...basis, model: 'claude-haiku-5-5', tools: [tool], tool_choice: { type: 'tool', name: 'classificeer' } }),
    ).resolves.toBeTruthy();
  });

  it('weigert onbekende modellen, temperature en prefill', async () => {
    await expect(maakNepClient([tekstAntwoord('x')]).messages.create({ ...basis, model: 'claude-haiku-5.5' })).rejects.toThrow(/404/);
    await expect(
      // temperature staat niet eens meer in de SDK-typen; daarom de cast.
      maakNepClient([tekstAntwoord('x')]).messages.create({ ...basis, model: 'claude-haiku-5-5', temperature: 0 } as never),
    ).rejects.toThrow(/temperature/);
    await expect(
      maakNepClient([tekstAntwoord('x')]).messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'Hoi' },
          { role: 'assistant', content: '{' },
        ],
      }),
    ).rejects.toThrow(/prefill/);
  });

  it('controleert tool_result-blokken tegen de tool_use-id’s', async () => {
    const client = maakNepClient([tekstAntwoord('x'), tekstAntwoord('y')]);
    const assistent = { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 'toolu_a', name: 'classificeer', input: {} }] };
    await expect(
      client.messages.create({
        ...basis,
        model: 'claude-haiku-5-5',
        messages: [basis.messages[0], assistent, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'x' }] }],
      }),
    ).rejects.toThrow(/toolu_a/);
    await expect(
      client.messages.create({
        ...basis,
        model: 'claude-haiku-5-5',
        messages: [basis.messages[0], assistent, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'x' }] }],
      }),
    ).resolves.toBeTruthy();
  });

  it('controleert het schema van gestructureerde output', async () => {
    const zonderAdditional = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    await expect(
      maakNepClient([jsonAntwoord({ a: 'x' })]).messages.create({
        ...basis,
        model: 'claude-haiku-5-5',
        output_config: { format: { type: 'json_schema', schema: zonderAdditional } },
      }),
    ).rejects.toThrow(/additionalProperties/);
    const metMinimum = { type: 'object', properties: { a: { type: 'number', minimum: 0 } }, required: ['a'], additionalProperties: false };
    await expect(
      maakNepClient([jsonAntwoord({ a: 1 })]).messages.create({
        ...basis,
        model: 'claude-haiku-5-5',
        output_config: { format: { type: 'json_schema', schema: metMinimum } },
      }),
    ).rejects.toThrow(/minimum/);
  });
});
