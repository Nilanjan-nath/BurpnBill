import { Router } from 'express';
import {
  getOverview,
  getMonthlyReport,
  listRestaurants,
  getRestaurantDetail,
  recordPayment,
  extendTrial,
  getInvoice,
} from '../services/platform.js';
import {
  parse,
  adminMonthQuery,
  adminRestaurantParams,
  adminPaymentParams,
  recordPaymentBody,
  extendTrialBody,
} from '../validate.js';

// The platform owner's area. Everything here crosses café boundaries on purpose, so
// the one thing that matters is the gate: requirePlatformAdmin runs before every
// route, and the limiter runs before it so a guessing script is stopped cheaply.
export function adminRoutes({ db, requirePlatformAdmin, limits, billingSeller }) {
  const router = Router();
  const admin = [limits.admin, requirePlatformAdmin];
  const seller = billingSeller ?? { name: 'BurpnBill' };

  // Does this login belong here? The admin screen asks before showing anything.
  router.get('/admin/me', admin, (req, res) => res.json({ admin: true }));

  router.get('/admin/overview', admin, async (req, res) => {
    res.json(await getOverview(db));
  });

  router.get('/admin/report', admin, async (req, res) => {
    const { month } = parse(adminMonthQuery, req.query);
    res.json(await getMonthlyReport(db, month));
  });

  router.get('/admin/restaurants', admin, async (req, res) => {
    res.json({ restaurants: await listRestaurants(db) });
  });

  router.get('/admin/restaurants/:restaurantId', admin, async (req, res) => {
    const { restaurantId } = parse(adminRestaurantParams, req.params);
    const { month } = parse(adminMonthQuery, req.query);
    res.json(await getRestaurantDetail(db, restaurantId, month));
  });

  router.post('/admin/restaurants/:restaurantId/payments', admin, async (req, res) => {
    const { restaurantId } = parse(adminRestaurantParams, req.params);
    const body = parse(recordPaymentBody, req.body);
    res.status(201).json(await recordPayment(db, req.admin.userId, restaurantId, body, seller));
  });

  router.post('/admin/restaurants/:restaurantId/extend-trial', admin, async (req, res) => {
    const { restaurantId } = parse(adminRestaurantParams, req.params);
    const { days } = parse(extendTrialBody, req.body);
    res.json(await extendTrial(db, req.admin.userId, restaurantId, days));
  });

  router.get('/admin/payments/:paymentId/invoice', admin, async (req, res) => {
    const { paymentId } = parse(adminPaymentParams, req.params);
    res.json(await getInvoice(db, paymentId));
  });

  return router;
}
