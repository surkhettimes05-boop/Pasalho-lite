import "../tests/setup-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function main() {
  const db = new URL(process.env.DATABASE_URL || "");
  const endpoint = new URL(process.env.CREATOR_ATTRIBUTION_API_URL || "");
  assert.equal(process.env.APP_ENV, "test");
  assert.ok(["127.0.0.1", "localhost"].includes(db.hostname));
  assert.match(db.pathname, /^\/pasalho_creator_test_[a-f0-9]+$/);
  assert.equal(endpoint.hostname, "127.0.0.1");
  assert.equal(endpoint.protocol, "http:");
  const { prisma } = await import("../src/lib/db");
  const { Role, PaymentMethod, ReturnSourceType } = await import("../src/generated/prisma/client");
  const { createCustomer } = await import("../src/modules/customers/customer.service");
  const { createProduct } = await import("../src/modules/products/product.service");
  const { adjustInventory } = await import("../src/modules/inventory/inventory.service");
  const { finalizeSale } = await import("../src/modules/pos/pos.service");
  const { processReturn } = await import("../src/modules/returns/return.service");
  const { dispatchCreatorAttributionOutbox } = await import("../src/modules/creator-attribution/outbox.service");
  const { installModernPricingMock } = await import("../tests/helpers/modern-pricing-mock");
  try {
    const phase = process.env.CASHIER_TEST_PHASE;
    const phone = process.env.CASHIER_TEST_PHONE!;
    const identity = process.env.CASHIER_TEST_IDENTITY!;
    const user = await prisma.user.findUniqueOrThrow({where:{email:process.env.SEED_OWNER_EMAIL!}});
    const owner = {id:user.id,name:user.name,email:user.email,role:Role.OWNER_ADMIN};
    const cashier = {...owner,role:Role.CASHIER_STORE};
    let eventId: string;
    const restore = installModernPricingMock();
    try {
      if (phase === "sale") {
        const customer = await createCustomer(cashier,{phone,name:"Cashier integration customer",notes:""});
        await prisma.customer.update({where:{id:customer.id},data:{membershipIdentityId:identity}});
        restore.setMembershipProfile(identity,{membershipNumber:42,membershipTier:"REGISTERED_MEMBER",membershipStatus:"ACTIVE"});
        const product = await createProduct(owner,{sku:"CASHIER-"+randomUUID(),barcode:"",name:"Cashier test product",category:"Test",unit:"pcs",costPrice:"300.00",sellingPrice:"505.00",mrp:"550.00",warehouseMinStock:"0",storeMinStock:"0",active:true});
        const store = await prisma.location.findUniqueOrThrow({where:{code:"STORE_MAIN"}});
        await adjustInventory(owner,{productId:product.id,locationId:store.id,direction:"IN",quantity:"10",reason:"Isolated opening stock",idempotencyKey:randomUUID()});
        const input = {idempotencyKey:identity,paymentMethod:PaymentMethod.CASH,customerId:customer.id,items:[{productId:product.id,quantity:"2"}]};
        const sale = await finalizeSale(cashier,input);
        assert.equal((await finalizeSale(cashier,input)).sale.id,sale.sale.id);
        eventId = sale.sale.id;
      } else {
        assert.ok(phase === "partial" || phase === "full");
        const sale = await prisma.sale.findUniqueOrThrow({where:{id:process.env.CASHIER_TEST_SALE_ID!},include:{items:true}});
        const input = {sourceType:ReturnSourceType.SALE,sourceId:sale.id,reason:"Isolated cashier refund",idempotencyKey:identity+"-"+phase,items:[{originalLineId:sale.items[0].id,quantity:"1",physicallyReturned:true,restockQuantity:"1"}]};
        const result = await processReturn(cashier,input);
        assert.equal((await processReturn(cashier,input)).id,result.id);
        eventId = result.id;
      }
    } finally { restore(); }
    const key = (phase === "sale" ? "pos-sale:" : "pos-return:")+eventId;
    const row = await prisma.creatorAttributionOutbox.findUniqueOrThrow({where:{eventKey:key}});
    assert.equal(await prisma.creatorAttributionOutbox.count({where:{eventKey:key}}),1);
    assert.equal(row.status,"PENDING");
    await dispatchCreatorAttributionOutbox();
    assert.equal((await prisma.creatorAttributionOutbox.findUniqueOrThrow({where:{eventKey:key}})).status,"SENT");
    console.log("CASHIER_EVENT_ID="+eventId);
  } finally { await prisma.$disconnect(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
