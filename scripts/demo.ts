/**
 * pnpm demo          — köfte demo, mock mode, incl. scripted mini-market
 *                      escrow-funding failure (item dropped via saga)
 * pnpm demo:timeout  — prep-timeout auto-refund demo (Cem Fırın never preps)
 *
 * Headless: boots merchant-agents + bridge in-process, drives the full flow,
 * prints the SSE timeline and the final unified receipt.
 */
import { microToUsdc, type TaskEvent } from "../packages/shared/src/index.js";
import { startStack, until, type Stack } from "../apps/local-agent-bridge/test/harness.js";

const PROMPT = "4 kişilik köfte yapacağım, gidip alacağım";
const prepTimeoutMode = process.argv.includes("--prep-timeout");
const failShop = prepTimeoutMode ? undefined : (process.env.DEMO_FAIL_SHOP ?? "mini-market");

const u = (micro: number) => `${microToUsdc(micro)} USDC`;

function printEvent(e: TaskEvent): void {
  const d = e.data as any;
  const line = (msg: string) => console.log(`  │ ${msg}`);
  switch (e.type) {
    case "plan_ready":
      line(`🧠 Plan hazır (${d.plan.items.length} kalem): ${d.plan.items.map((i: any) => `${i.sku}×${i.qty}${i.essential ? "*" : ""}`).join(", ")}  (*=olmazsa olmaz)`);
      break;
    case "discovery_complete":
      line(`📍 ${d.count} esnaf bulundu: ${d.merchants.map((m: any) => `${m.name} (${m.distanceM}m)`).join(", ")}`);
      break;
    case "paid_request":
      line(`💸 ${d.endpoint} @ ${d.merchantName} — ${u(d.amountMicroUsdc)}${d.feeRefunded ? " (ücret iade edildi)" : ""} | bütçe: ${u(d.budget.spentMicroUsdc)}/${u(d.budget.totalMicroUsdc)}`);
      break;
    case "quote_received":
      line(`🧾 Teklif: ${d.merchantName} → ${u(d.totalMicroUsdc)} (nonce ${d.nonce}, imza ${d.signatureVerified ? "✓ doğrulandı" : "✗ GEÇERSİZ"})`);
      break;
    case "quality_scored":
      line(`⭐ Kalite oracle (${d.sku}): ${d.merchants.map((m: any) => `${m.merchantName} ${m.qualityScore}/10 @ ${u(m.unitPriceMicroUsdc)}`).join(" vs ")}`);
      break;
    case "reservation_made":
      line(`🔒 Rezervasyon: ${d.merchantName} — ${d.sku}×${d.qty} (TTL ${d.ttlSeconds}s) ${d.reason}`);
      break;
    case "negotiation_success":
      line(`🤝 Pazarlık BAŞARILI: ${d.merchantName} — indirim ${u(d.discountMicroUsdc)}, yeni toplam ${u(d.newTotalMicroUsdc)} (ücret ${u(d.feeMicroUsdc)} esnafta kaldı)`);
      break;
    case "negotiation_declined":
      line(`🤝 Pazarlık reddedildi: ${d.merchant} (${d.reason})${d.feeRefunded ? " — ücret otomatik iade" : ""}`);
      break;
    case "budget_blocked":
      line(`⛔ BÜTÇE ENGELİ (${d.kind}): ${d.detail}`);
      break;
    case "options_ready":
      line(`📊 Seçenekler hazır — araştırma harcaması: ${u(d.budget.spentMicroUsdc)}`);
      break;
    case "escrow_funded":
      line(`🏦 Escrow fonlandı: ${d.merchantName} — ${u(d.amountMicroUsdc)} (escrow #${d.escrowOrderId}, ${d.txRef}) teslim kodu: ${d.pickupCode}`);
      break;
    case "funding_failed":
      line(`❌ Fonlama HATASI: ${d.merchantName ?? d.merchant} — ${d.error}`);
      break;
    case "shop_dropped":
      line(`🪂 Saga: ${d.merchantName} düşürüldü (${d.items.map((i: any) => i.sku).join(", ")}) — ${d.reason}`);
      break;
    case "saga_alternative":
      line(`🔁 Saga: ${d.failedMerchant} yerine alternatif ${d.alternativeMerchant} deneniyor`);
      break;
    case "order_update":
      line(`📦 ${d.merchantName ?? d.merchant}: ${d.state}${d.txRef ? ` (${d.txRef})` : ""}${d.note ? ` — ${d.note}` : ""}`);
      break;
    case "receipt_ready":
      line(`🧾 Makbuz zincire yazıldı: ${d.receipt.receiptTx}`);
      break;
  }
}

async function main(): Promise<void> {
  console.log("┌─ MerchantMesh — headless demo (mock mode)");
  console.log(`  │ Prompt: "${PROMPT}"`);
  if (failShop) console.log(`  │ DEMO_FAIL_SHOP=${failShop} — escrow fonlaması bilerek patlayacak`);
  if (prepTimeoutMode) console.log("  │ DEMO_PREP_TIMEOUT — cem-firin hazırlamayacak, otomatik iade izlenecek");

  const stack: Stack = await startStack({
    failSlugs: failShop ? [failShop] : [],
    prepTimeoutShop: prepTimeoutMode ? "cem-firin" : undefined,
    prepTimeoutSecs: 3,
  });

  const taskId = stack.orchestrator.createTask(PROMPT, 39.9208, 32.8541);
  stack.bus.subscribe(taskId, printEvent);

  // 1. Research: plan → discovery → paid quotes → micro-actions → options
  await stack.orchestrator.runResearch(taskId);
  const snapshot = (await stack.orchestrator.taskSnapshot(taskId))!;
  if (snapshot.status !== "options_ready") throw new Error(`research failed: ${snapshot.error}`);

  console.log("  │");
  console.log("  │ ── SEÇENEKLER ──");
  for (const option of snapshot.options) {
    console.log(
      `  │ [${option.kind}] ${option.label}: ${u(option.totalMicroUsdc)} — ${option.stops} durak, ~${option.totalWalkM}m, kalite ${option.avgQuality}/10`,
    );
    for (const shop of option.shops) {
      console.log(`  │     • ${shop.merchantName} (${shop.distanceM}m): ${shop.items.map((i: any) => `${i.sku}×${i.qty}`).join(", ")} = ${u(shop.subtotalMicroUsdc)}`);
    }
  }

  // 2. User selects Best Quality and approves the final payment.
  console.log("  │");
  console.log("  │ 👤 Kullanıcı seçimi: best_quality → ödeme onayı");
  stack.orchestrator.selectOption(taskId, "best_quality");
  await stack.orchestrator.approvePayment(taskId);

  const afterFunding = (await stack.orchestrator.taskSnapshot(taskId))!;
  if (afterFunding.status !== "in_progress") throw new Error(`funding failed: ${afterFunding.error}`);

  if (prepTimeoutMode) {
    // Drive every shop except the stuck one; the worker refunds the rest.
    await until(async () => (await stack.orchestrator.taskSnapshot(taskId))!.orders.every(
      (o: any) => o.merchantSlug === "cem-firin" || o.state === "preparing",
    ), 8000, "auto-prepare");
    for (const order of (await stack.orchestrator.taskSnapshot(taskId))!.orders) {
      if (order.merchantSlug === "cem-firin") continue;
      await consoleReadyAndVerify(stack, order);
    }
    console.log("  │ ⏳ Cem Fırın hazırlamıyor — releaseDeadline bekleniyor…");
    await new Promise((r) => setTimeout(r, 3_500));
    await stack.merchantWorker.tick();
  } else {
    await until(async () => (await stack.orchestrator.taskSnapshot(taskId))!.orders.every((o: any) => o.state !== "paid_in_escrow"), 8000, "auto-prepare");
    console.log("  │");
    console.log("  │ ── ESNAF KONSOLU: hazır işaretle + teslim kodu doğrula ──");
    for (const order of (await stack.orchestrator.taskSnapshot(taskId))!.orders) {
      await consoleReadyAndVerify(stack, order);
    }
  }

  await until(async () => (await stack.orchestrator.taskSnapshot(taskId))!.status === "settled", 10_000, "settlement");
  const receipt = (await stack.orchestrator.taskSnapshot(taskId))!.receipt;

  console.log("  │");
  console.log("  │ ══════════ BİRLEŞİK MAKBUZ ══════════");
  console.log(`  │ Görev: ${receipt.taskRef}`);
  console.log(`  │ Araştırma harcaması: ${u(receipt.totalResearchMicroUsdc)} (bütçe: 0.01 USDC)`);
  console.log(`  │ Ana ödeme toplamı:   ${u(receipt.totalMainMicroUsdc)}`);
  console.log(`  │ Tamamlanan kalem:    ${receipt.completedItems}/${receipt.totalItems}`);
  console.log(`  │ Tamamlanan dükkan:   ${receipt.completedShops}/${receipt.totalShops}`);
  for (const shop of receipt.shops) {
    const mark = shop.status === "completed" ? "✅" : shop.status === "dropped" ? "🪂" : "↩️";
    console.log(`  │  ${mark} ${shop.merchantName} [${shop.status}] ${u(shop.amountMicroUsdc)}${shop.note ? ` — ${shop.note}` : ""}`);
    if (shop.releaseTx) console.log(`  │      release tx: ${shop.releaseTx}`);
  }
  console.log(`  │ Metadata hash: ${receipt.metadataHash}`);
  console.log(`  │ Makbuz tx:     ${receipt.receiptTx}`);
  console.log(`  │ Cüzdan bakiyesi: ${u(await stack.chain.walletBalanceMicroUsdc())}`);
  console.log("  └─ Demo tamamlandı ✔");

  await stack.close();
  process.exit(0);
}

async function consoleReadyAndVerify(stack: Stack, order: any): Promise<void> {
  const headers = { "content-type": "application/json" };
  const ready = await fetch(`${stack.merchantsUrl}/merchant/${order.merchantSlug}/ready`, {
    method: "POST", headers, body: JSON.stringify({ orderId: order.orderId }),
  });
  if (ready.status !== 200) throw new Error(`ready failed for ${order.merchantSlug}: ${await ready.text()}`);
  const verify = await fetch(`${stack.merchantsUrl}/merchant/${order.merchantSlug}/verify-pickup`, {
    method: "POST", headers, body: JSON.stringify({ orderId: order.orderId, code: order.pickupCode }),
  });
  if (verify.status !== 200) throw new Error(`verify-pickup failed for ${order.merchantSlug}: ${await verify.text()}`);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
