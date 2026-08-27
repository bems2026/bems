import { describe, it, expect, vi, afterEach } from 'vitest';
import { useDeviceConfigStore } from './deviceConfigStore';
import * as supabaseDeviceConfig from '@/lib/supabaseDeviceConfig';
import { emptyDeviceConfig } from '@/lib/deviceConfig';

vi.mock('@/config/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }) } },
}));
vi.mock('@/lib/supabaseDeviceConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabaseDeviceConfig')>();
  return { ...actual, fetchDeviceConfigs: vi.fn(), writeDeviceConfig: vi.fn() };
});

afterEach(() => {
  // Reset only the two supabaseDeviceConfig mocks, not the '@/config/supabase' mock's
  // getSession — that one's mockResolvedValue is set once in the factory above and must
  // survive every test. vi.restoreAllMocks() would leave prior tests' mockResolvedValue/
  // mockRejectedValue AND call counts on writeDeviceConfig/fetchDeviceConfigs in place (it
  // only rewinds vi.spyOn spies, and a plain vi.fn() built inside a vi.mock() factory isn't
  // one), which silently broke this file's own "not have been called" assertions until this
  // was caught; a blanket vi.resetAllMocks() overcorrects by also wiping getSession.
  vi.mocked(supabaseDeviceConfig.fetchDeviceConfigs).mockReset();
  vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockReset();
  useDeviceConfigStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null, lastSave: null });
});

describe('useDeviceConfigStore.load', () => {
  it('populates saved from fetchDeviceConfigs', async () => {
    vi.mocked(supabaseDeviceConfig.fetchDeviceConfigs).mockResolvedValue({ co1: { ...emptyDeviceConfig('co1'), room: 'Lab 2' } });
    await useDeviceConfigStore.getState().load();
    const { saved, status } = useDeviceConfigStore.getState();
    expect(status).toBe('ready');
    expect(saved.co1.room).toBe('Lab 2');
  });
});

describe('useDeviceConfigStore.setDraftField', () => {
  it('stages a change without touching saved', () => {
    useDeviceConfigStore.getState().setDraftField('co1', 'room', 'CARE Office');
    const { draft, saved } = useDeviceConfigStore.getState();
    expect(draft.co1.room).toBe('CARE Office');
    expect(saved.co1).toBeUndefined();
  });

  it('coerces an unrecognized category/load-shed value to null rather than storing it raw', () => {
    useDeviceConfigStore.getState().setDraftField('co1', 'category', 'not-a-real-option');
    expect(useDeviceConfigStore.getState().draft.co1.category).toBeNull();
  });

  it('builds each field on top of the effective (draft-or-saved) config, not a blank one', () => {
    useDeviceConfigStore.setState({ saved: { co1: { ...emptyDeviceConfig('co1'), room: 'Lab 2' } } });
    useDeviceConfigStore.getState().setDraftField('co1', 'notes', 'near the breaker panel');
    const draftCo1 = useDeviceConfigStore.getState().draft.co1;
    expect(draftCo1.room).toBe('Lab 2');
    expect(draftCo1.notes).toBe('near the breaker panel');
  });
});

describe('useDeviceConfigStore.save', () => {
  it('writes the normalized config, updates saved, clears the draft, and records lastSave for this device', async () => {
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockResolvedValue(undefined);
    useDeviceConfigStore.getState().setDraftField('co1', 'room', '  CARE Office  ');

    const before = Date.now();
    await useDeviceConfigStore.getState().save('co1');
    const { saved, draft, saveStatus, lastSave } = useDeviceConfigStore.getState();

    expect(supabaseDeviceConfig.writeDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'co1', room: 'CARE Office' }), 'user-1');
    expect(saved.co1.room).toBe('CARE Office');
    expect(draft.co1).toBeUndefined();
    expect(saveStatus).toBe('idle');
    expect(lastSave).toEqual({ at: expect.any(Number), deviceId: 'co1' });
    expect(lastSave!.at).toBeGreaterThanOrEqual(before);
  });

  it('is a no-op when nothing is staged for that device', async () => {
    await useDeviceConfigStore.getState().save('co1');
    expect(supabaseDeviceConfig.writeDeviceConfig).not.toHaveBeenCalled();
  });

  it('is a no-op when the normalized draft is identical to what is already saved', async () => {
    useDeviceConfigStore.setState({ saved: { co1: { ...emptyDeviceConfig('co1'), room: 'CARE Office' } } });
    useDeviceConfigStore.getState().setDraftField('co1', 'room', '  CARE Office  '); // same value, just untrimmed
    await useDeviceConfigStore.getState().save('co1');
    expect(supabaseDeviceConfig.writeDeviceConfig).not.toHaveBeenCalled();
    expect(useDeviceConfigStore.getState().draft.co1).toBeUndefined();
  });

  it('leaves the edit pending and reports the error when the write fails, so a stale success is never shown', async () => {
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockRejectedValue(new Error('affected 0 rows'));
    useDeviceConfigStore.getState().setDraftField('co1', 'room', 'CARE Office');

    await useDeviceConfigStore.getState().save('co1');
    const { saveStatus, saveError, draft, lastSave } = useDeviceConfigStore.getState();

    expect(saveStatus).toBe('error');
    expect(saveError).toBe('affected 0 rows');
    expect(draft.co1.room).toBe('CARE Office');
    expect(lastSave).toBeNull();
  });
});

describe('useDeviceConfigStore.placeOnPlan (RM-031)', () => {
  const placed = (over = {}) => ({ ...emptyDeviceConfig('co1'), spaceNodeId: 'lab', ...over });

  it('saves a dropped pin immediately, rather than staging it behind a Save button', async () => {
    // A drag IS the confirmation. Leaving the pin where it was dropped while the change sits
    // unsaved would show a position the database does not have.
    useDeviceConfigStore.setState({ saved: { co1: placed() } });
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockResolvedValue(undefined);

    await useDeviceConfigStore.getState().placeOnPlan('co1', { x: 0.25, y: 0.75 });

    const { saved, draft, saveError } = useDeviceConfigStore.getState();
    expect(saveError).toBeNull();
    expect(saved.co1).toMatchObject({ planX: 0.25, planY: 0.75 });
    expect(draft.co1).toBeUndefined();
  });

  it('keeps everything else about the device', () => {
    // The write is a whole-row upsert, so a place that started from a blank config would erase
    // the notes, category and shed tier of the device being dragged.
    useDeviceConfigStore.setState({ saved: { co1: placed({ notes: 'near the breaker', loadShedGroup: 'never' }) } });
    useDeviceConfigStore.getState().setDraftPosition('co1', { x: 0.25, y: 0.75 });
    expect(useDeviceConfigStore.getState().draft.co1).toMatchObject({
      notes: 'near the breaker',
      loadShedGroup: 'never',
      spaceNodeId: 'lab',
      planX: 0.25,
      planY: 0.75,
    });
  });

  it('takes a pin off the plan without unplacing the device from its room', async () => {
    // Two different states. "Not on the plan" is a device in the Lab whose spot nobody has
    // marked; "not in the Lab" is a different claim entirely.
    useDeviceConfigStore.setState({ saved: { co1: placed({ planX: 0.25, planY: 0.75 }) } });
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockResolvedValue(undefined);

    await useDeviceConfigStore.getState().placeOnPlan('co1', null);

    expect(useDeviceConfigStore.getState().saved.co1).toMatchObject({ spaceNodeId: 'lab', planX: null, planY: null });
  });

  it('surfaces a failed write instead of leaving the pin looking saved', async () => {
    useDeviceConfigStore.setState({ saved: { co1: placed() } });
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockRejectedValue(new Error('policy matched no rows'));

    await useDeviceConfigStore.getState().placeOnPlan('co1', { x: 0.25, y: 0.75 });

    const { saveStatus, saveError, saved } = useDeviceConfigStore.getState();
    expect(saveStatus).toBe('error');
    expect(saveError).toMatch(/policy matched no rows/);
    expect(saved.co1.planX).toBeNull();
  });

  it('refuses to position a device that is not in a space at all', async () => {
    // phase23's third invariant. A position with no room to be a position in is not a position,
    // and sending it would come back as a raw constraint name.
    useDeviceConfigStore.setState({ saved: { co1: emptyDeviceConfig('co1') } });
    vi.mocked(supabaseDeviceConfig.writeDeviceConfig).mockResolvedValue(undefined);

    await useDeviceConfigStore.getState().placeOnPlan('co1', { x: 0.25, y: 0.75 });

    expect(vi.mocked(supabaseDeviceConfig.writeDeviceConfig)).not.toHaveBeenCalled();
    expect(useDeviceConfigStore.getState().saved.co1.planX).toBeNull();
  });
});
