import { ChatTabReservations } from '@/core/chatTabReservations';

describe('ChatTabReservations', () => {
  it('counts outstanding reservations as pending', () => {
    const reservations = new ChatTabReservations();
    expect(reservations.pending).toBe(0);

    const a = reservations.reserve();
    const b = reservations.reserve();
    expect(reservations.pending).toBe(2);

    a.release();
    expect(reservations.pending).toBe(1);
    b.release();
    expect(reservations.pending).toBe(0);
  });

  it('releases idempotently so the view and coordinator can both release', () => {
    const reservations = new ChatTabReservations();
    const r = reservations.reserve();
    expect(reservations.pending).toBe(1);

    r.release();
    r.release();
    expect(reservations.pending).toBe(0);
  });

  it('never underflows below zero', () => {
    const reservations = new ChatTabReservations();
    const a = reservations.reserve();
    const b = reservations.reserve();
    a.release();
    b.release();
    // A stray double-release on one handle must not drop the count below 0 and
    // make a real reservation look free.
    a.release();
    expect(reservations.pending).toBe(0);

    reservations.reserve();
    expect(reservations.pending).toBe(1);
  });
});
