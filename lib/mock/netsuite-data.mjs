// FAKE NetSuite records for MOCK MODE only. Shapes match what lib/netsuite.mjs returns.
// RMA100001 mirrors the Helms example (1 pallet 48x40x60, 718 lb of items).
// RMA100002 mirrors the Lusk example (96x40x20 @ 691.6 lb + 48x40x60 @ 1,003 lb).
// RMA100003 is for the "customer sourced a different pallet" scenario.
// RMA100004 has no lines.

export const MOCK_RMAS = {
  RMA100001: {
    rma: {
      number: 'RMA100001', id: 'mock-1', memo: 'Customer refused delivery - damaged box (MOCK)',
      lines: [
        { lineId: '1', sku: 'DBS-3000-550', description: 'Rubber Hex Dumbbell Set 5-50lb', qty: 1, unitWeightLb: 600 },
        { lineId: '2', sku: 'WS-5100', description: 'DB Storage Rack - Black', qty: 1, unitWeightLb: 118 },
      ],
    },
    salesOrder: { number: 'SO1000001', po: 'MOCK-PO-1001', orderDate: '2026-10-07', shipDate: '2026-10-07' },
    customer: {
      name: 'MOCK CUSTOMER HELMS', attn: 'MOCK CUSTOMER HELMS', address1: '1816 MOCK LN', address2: '',
      city: 'SAN JOSE', state: 'CA', zip: '95124', phone: '4085550100', email: 'mock.customer1@example.com',
      residential: true,
    },
    originalShipment: { source: 'MOCK item fulfillment IF1000001', palletCount: null, pro: '' }, // NetSuite has no container sizes
  },
  RMA100002: {
    rma: {
      number: 'RMA100002', id: 'mock-2', memo: '',
      lines: [
        { lineId: '1', sku: 'PR-5000-UP-80-MBLK', description: 'PR-5000 Uprights Pair - 80" - Metallic Black (MOCK)', qty: 1, unitWeightLb: 691.6 },
        { lineId: '2', sku: 'PRA-FT-DUAL-5003-S', description: 'Titan 2.0 Base and Weight Stacks - 5000 Series (MOCK)', qty: 1, unitWeightLb: 1003 },
      ],
    },
    salesOrder: { number: 'SO2000002', po: 'MOCK-PO-2002', orderDate: '2026-09-20', shipDate: '2026-09-22' },
    customer: {
      name: 'MOCK CUSTOMER LUSK', attn: 'MOCK CUSTOMER LUSK', address1: '100 MOCK INDUSTRIAL WAY', address2: 'SUITE 5',
      city: 'COLUMBUS', state: 'OH', zip: '43215', phone: '6145550100', email: 'mock.customer2@example.com',
      residential: false,
    },
    originalShipment: { source: 'MOCK item fulfillment IF2000002', palletCount: null, pro: '' }, // NetSuite has no container sizes
  },
  RMA100003: {
    rma: {
      number: 'RMA100003', id: 'mock-3', memo: 'Original pallet discarded; customer sourced a new one (MOCK)',
      lines: [{ lineId: '1', sku: 'MOCK-BENCH-01', description: 'Mock Adjustable Bench (MOCK ITEM)', qty: 3, unitWeightLb: 120 }],
    },
    salesOrder: { number: 'SO2000003', po: 'MOCK-PO-2003', orderDate: '2026-09-01', shipDate: '2026-09-03' },
    customer: {
      name: 'MOCK CUSTOMER THREE', attn: 'MOCK CUSTOMER THREE', address1: '9 MOCK LANE', address2: '',
      city: 'DENVER', state: 'CO', zip: '80202', phone: '3035550123', email: 'mock.customer3@example.com',
      residential: true,
    },
    originalShipment: { source: 'MOCK item fulfillment IF2000003', palletCount: null, pro: '' }, // NetSuite has no container sizes
  },
  RMA100004: {
    rma: { number: 'RMA100004', id: 'mock-4', memo: '', lines: [] },
    salesOrder: { number: 'SO2000004', po: '', orderDate: '2026-09-01', shipDate: '2026-09-02' },
    customer: {
      name: 'MOCK CUSTOMER FOUR', attn: '', address1: '1 MOCK RD', address2: '', city: 'MESA', state: 'AZ', zip: '85201',
      phone: '4805550111', email: 'mock.customer4@example.com', residential: true,
    },
    originalShipment: { source: 'none', pallets: [] },
  },
};
