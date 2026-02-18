'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../layout';
import { createClient } from '@/lib/supabase/client';
import DocumentViewer from '@/components/ocr/DocumentViewer';
import OCRForm from '@/components/ocr/OCRForm';
import DocumentQueue from '@/components/ocr/DocumentQueue';
import { useMultiTableRealtime } from '@/hooks/useRealtimeSubscription';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { OCRDocument, OCRFormData, DocumentStatus, OCRExtractedData, DocumentType } from '@/types/ocr';
import { Button } from "@/components/ui/button";

interface Business {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
  waiting_for_coordinator?: boolean;
}

export default function OCRPage() {
  const router = useRouter();
  const { isAdmin } = useDashboard();

  // State - ALL hooks must be declared before any conditional returns
  const [documents, setDocuments] = useState<OCRDocument[]>([]);
  const [currentDocument, setCurrentDocument] = useState<OCRDocument | null>(null);
  const [filterStatus, setFilterStatus] = usePersistedState<DocumentStatus | 'all'>('ocr:filterStatus', 'pending');
  const [isLoading, setIsLoading] = useState(false);
  const [showMobileViewer, setShowMobileViewer] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Fetch OCR documents from Supabase
  const fetchDocuments = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('ocr_documents')
      .select('*, ocr_extracted_data(*, ocr_extracted_line_items(*))')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching OCR documents:', error);
      return;
    }

    if (data) {
      const mapped: OCRDocument[] = data.map((doc: Record<string, unknown>) => {
        const extracted = Array.isArray(doc.ocr_extracted_data) && doc.ocr_extracted_data.length > 0
          ? doc.ocr_extracted_data[0] as Record<string, unknown>
          : null;

        // Map line items from nested relation
        const rawLineItems = Array.isArray(extracted?.ocr_extracted_line_items)
          ? (extracted.ocr_extracted_line_items as Record<string, unknown>[])
          : [];
        const lineItems = rawLineItems.map((li) => ({
          id: li.id as string,
          description: (li.description as string) || undefined,
          quantity: li.quantity != null ? Number(li.quantity) : undefined,
          unit_price: li.unit_price != null ? Number(li.unit_price) : undefined,
          total: li.total != null ? Number(li.total) : undefined,
        }));

        const ocrData: OCRExtractedData | undefined = extracted ? {
          supplier_name: (extracted.supplier_name as string) || undefined,
          supplier_tax_id: (extracted.supplier_tax_id as string) || undefined,
          document_number: (extracted.document_number as string) || undefined,
          document_date: extracted.document_date ? String(extracted.document_date) : undefined,
          subtotal: extracted.subtotal != null ? Number(extracted.subtotal) : undefined,
          vat_amount: extracted.vat_amount != null ? Number(extracted.vat_amount) : undefined,
          total_amount: extracted.total_amount != null ? Number(extracted.total_amount) : undefined,
          confidence_score: extracted.overall_confidence != null ? Number(extracted.overall_confidence) : undefined,
          raw_text: (extracted.raw_text as string) || undefined,
          matched_supplier_id: (extracted.matched_supplier_id as string) || undefined,
          line_items: lineItems.length > 0 ? lineItems : undefined,
        } : undefined;

        return {
          id: doc.id as string,
          business_id: doc.business_id as string,
          source: (doc.source as string || 'upload') as OCRDocument['source'],
          source_sender_name: (doc.source_sender_name as string) || undefined,
          source_sender_phone: (doc.source_sender_phone as string) || undefined,
          image_url: doc.image_url as string,
          original_filename: (doc.original_filename as string) || undefined,
          file_type: (doc.file_type as string) || undefined,
          status: (doc.status as string || 'pending') as DocumentStatus,
          document_type: (doc.document_type as DocumentType) || undefined,
          ocr_data: ocrData,
          created_at: doc.created_at as string,
          processed_at: (doc.ocr_processed_at as string) || undefined,
          reviewed_by: (doc.reviewed_by as string) || undefined,
          reviewed_at: (doc.reviewed_at as string) || undefined,
          rejection_reason: (doc.rejection_reason as string) || undefined,
          created_invoice_id: (doc.created_invoice_id as string) || undefined,
          created_payment_id: (doc.created_payment_id as string) || undefined,
          created_delivery_note_id: (doc.created_delivery_note_id as string) || undefined,
        };
      });
      setDocuments(mapped);
    }
  }, []);

  // Business and supplier state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState('ocr:businessId', '');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [coordinatorSuppliers, setCoordinatorSuppliers] = useState<Supplier[]>([]);

  // Check admin access
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsCheckingAuth(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Redirect non-admin users
  useEffect(() => {
    if (!isCheckingAuth && !isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, isCheckingAuth, router]);

  // Fetch OCR documents when admin is confirmed
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      fetchDocuments();
    }
  }, [isCheckingAuth, isAdmin, fetchDocuments]);

  // Realtime subscription - auto-refresh when new documents arrive or data changes
  useMultiTableRealtime(
    ['ocr_documents', 'ocr_extracted_data'],
    fetchDocuments,
    !isCheckingAuth && isAdmin
  );

  // Fetch businesses (admin sees all active businesses)
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      const fetchBusinesses = async () => {
        const supabase = createClient();
        const { data } = await supabase
          .from('businesses')
          .select('id, name')
          .is('deleted_at', null)
          .eq('status', 'active')
          .order('name');

        if (data && data.length > 0) {
          setBusinesses(data);
          // Auto-select first business if none selected
          if (!selectedBusinessId) {
            setSelectedBusinessId(data[0].id);
          }
        }
      };
      fetchBusinesses();
    }
  }, [isCheckingAuth, isAdmin, selectedBusinessId, setSelectedBusinessId]);

  // Fetch suppliers when selected business changes
  useEffect(() => {
    if (!selectedBusinessId) {
      setSuppliers([]);
      setCoordinatorSuppliers([]);
      return;
    }

    const fetchSuppliers = async () => {
      const supabase = createClient();

      // Fetch all active suppliers
      const { data } = await supabase
        .from('suppliers')
        .select('id, name, waiting_for_coordinator, notes')
        .eq('business_id', selectedBusinessId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name');

      if (data) {
        setSuppliers(data);
        // Filter coordinator suppliers separately for summary tab
        setCoordinatorSuppliers(data.filter(s => s.waiting_for_coordinator === true));
      }
    };
    fetchSuppliers();
  }, [selectedBusinessId]);

  // Select first pending document on load
  useEffect(() => {
    if (!isCheckingAuth && isAdmin) {
      const pendingDocs = documents.filter((doc) => doc.status === 'pending');
      if (pendingDocs.length > 0 && !currentDocument) {
        handleSelectDocument(pendingDocs[0]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, currentDocument, isCheckingAuth, isAdmin]);

  // Handle document selection
  const handleSelectDocument = useCallback((document: OCRDocument) => {
    setCurrentDocument(document);
    // Auto-select the business identified by AI from the document
    if (document.business_id) {
      setSelectedBusinessId(document.business_id);
    }
    if (document.status === 'pending') {
      // Update local state immediately for UI responsiveness
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, status: 'reviewing' as DocumentStatus } : doc
        )
      );
      // Switch filter so user can see the document they're working on
      setFilterStatus('reviewing');
      // Update status in Supabase (fire-and-forget)
      const supabase = createClient();
      supabase.from('ocr_documents').update({ status: 'reviewing' }).eq('id', document.id);
    }
  }, [setSelectedBusinessId, setFilterStatus]);

  // Handle form approval - saves to Supabase based on document type
  const handleApprove = useCallback(
    async (formData: OCRFormData) => {
      if (!currentDocument) return;

      setIsLoading(true);
      const supabase = createClient();

      try {
        const { data: { user } } = await supabase.auth.getUser();

        // Fetch credit cards for billing day lookup (if any payment method uses credit card)
        const hasCreditCard = formData.payment_methods?.some(pm => pm.method === 'credit_card' && pm.creditCardId);
        let creditCardsMap: Record<string, number> = {};
        if (hasCreditCard && formData.business_id) {
          const { data: cards } = await supabase
            .from('business_credit_cards')
            .select('id, billing_day')
            .eq('business_id', formData.business_id)
            .eq('is_active', true);
          if (cards) {
            creditCardsMap = Object.fromEntries(cards.map(c => [c.id, c.billing_day]));
          }
        }

        // Calculate due date based on credit card billing day
        const calcCreditCardDueDate = (paymentDateStr: string, billingDay: number): string => {
          const payDate = new Date(paymentDateStr);
          if (payDate.getDate() < billingDay) {
            return new Date(payDate.getFullYear(), payDate.getMonth(), billingDay).toISOString().split('T')[0];
          } else {
            return new Date(payDate.getFullYear(), payDate.getMonth() + 1, billingDay).toISOString().split('T')[0];
          }
        };

        // Track created record IDs for linking back to ocr_documents
        let createdInvoiceId: string | null = null;
        let createdPaymentId: string | null = null;
        let createdDeliveryNoteId: string | null = null;

        if (formData.document_type === 'invoice' || formData.document_type === 'credit_note') {
          // --- INVOICE / CREDIT NOTE ---
          const { data: newInvoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              invoice_number: formData.document_number || null,
              invoice_date: formData.document_date,
              subtotal: parseFloat(formData.amount_before_vat),
              vat_amount: parseFloat(formData.vat_amount),
              total_amount: parseFloat(formData.total_amount),
              status: formData.is_paid ? 'paid' : 'pending',
              notes: formData.notes || null,
              created_by: user?.id || null,
              invoice_type: formData.expense_type === 'goods' ? 'goods' : 'current',
            })
            .select()
            .single();

          if (invoiceError) throw invoiceError;
          createdInvoiceId = newInvoice?.id || null;

          // If paid, create payment + payment splits
          if (formData.is_paid && newInvoice && formData.payment_methods) {
            const paymentTotal = formData.payment_methods.reduce((sum, pm) => {
              return sum + (parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0);
            }, 0);

            const { data: newPayment, error: paymentError } = await supabase
              .from('payments')
              .insert({
                business_id: formData.business_id,
                supplier_id: formData.supplier_id,
                payment_date: formData.payment_date || formData.document_date,
                total_amount: paymentTotal || parseFloat(formData.total_amount),
                invoice_id: newInvoice.id,
                notes: formData.payment_notes || null,
                created_by: user?.id || null,
              })
              .select()
              .single();

            if (paymentError) throw paymentError;
            createdPaymentId = newPayment?.id || null;

            if (newPayment) {
              for (const pm of formData.payment_methods) {
                const amount = parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0;
                if (amount > 0 && pm.method) {
                  const installmentsCount = parseInt(pm.installments) || 1;
                  const creditCardId = pm.method === 'credit_card' && pm.creditCardId ? pm.creditCardId : null;
                  const billingDay = creditCardId ? creditCardsMap[creditCardId] : null;

                  if (pm.customInstallments.length > 0) {
                    for (const inst of pm.customInstallments) {
                      await supabase.from('payment_splits').insert({
                        payment_id: newPayment.id,
                        payment_method: pm.method,
                        amount: inst.amount,
                        installments_count: installmentsCount,
                        installment_number: inst.number,
                        reference_number: formData.payment_reference || null,
                        check_number: pm.checkNumber || null,
                        credit_card_id: creditCardId,
                        due_date: inst.dateForInput || null,
                      });
                    }
                  } else {
                    const effectiveDate = formData.payment_date || formData.document_date;
                    const dueDate = billingDay && effectiveDate
                      ? calcCreditCardDueDate(effectiveDate, billingDay)
                      : effectiveDate || null;

                    await supabase.from('payment_splits').insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: amount,
                      installments_count: 1,
                      installment_number: 1,
                      reference_number: formData.payment_reference || null,
                      check_number: pm.checkNumber || null,
                      credit_card_id: creditCardId,
                      due_date: dueDate,
                    });
                  }
                }
              }
            }
          }

        } else if (formData.document_type === 'delivery_note') {
          // --- DELIVERY NOTE ---
          const { data: newDeliveryNote, error: deliveryNoteError } = await supabase
            .from('delivery_notes')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              delivery_note_number: formData.document_number || null,
              delivery_date: formData.document_date,
              subtotal: parseFloat(formData.amount_before_vat),
              vat_amount: parseFloat(formData.vat_amount),
              total_amount: parseFloat(formData.total_amount),
              notes: formData.notes || null,
              is_verified: false,
            })
            .select()
            .single();

          if (deliveryNoteError) throw deliveryNoteError;
          createdDeliveryNoteId = newDeliveryNote?.id || null;

        } else if (formData.document_type === 'payment') {
          // --- PAYMENT ---
          const totalAmount = formData.payment_methods
            ? formData.payment_methods.reduce((sum, pm) => sum + (parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0), 0)
            : parseFloat(formData.total_amount);

          const { data: newPayment, error: paymentError } = await supabase
            .from('payments')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              payment_date: formData.document_date,
              total_amount: totalAmount,
              notes: formData.payment_notes || formData.notes || null,
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (paymentError) throw paymentError;
          createdPaymentId = newPayment?.id || null;

          // Create payment splits
          if (newPayment && formData.payment_methods) {
            for (const pm of formData.payment_methods) {
              const amount = parseFloat(pm.amount.replace(/[^\d.]/g, '')) || 0;
              if (amount > 0 && pm.method) {
                const installmentsCount = parseInt(pm.installments) || 1;
                const creditCardId = pm.method === 'credit_card' && pm.creditCardId ? pm.creditCardId : null;
                const billingDay = creditCardId ? creditCardsMap[creditCardId] : null;

                if (pm.customInstallments.length > 0) {
                  for (const inst of pm.customInstallments) {
                    await supabase.from('payment_splits').insert({
                      payment_id: newPayment.id,
                      payment_method: pm.method,
                      amount: inst.amount,
                      installments_count: installmentsCount,
                      installment_number: inst.number,
                      reference_number: formData.payment_reference || null,
                      check_number: pm.checkNumber || null,
                      credit_card_id: creditCardId,
                      due_date: inst.dateForInput || null,
                    });
                  }
                } else {
                  const dueDate = billingDay && formData.document_date
                    ? calcCreditCardDueDate(formData.document_date, billingDay)
                    : formData.document_date || null;

                  await supabase.from('payment_splits').insert({
                    payment_id: newPayment.id,
                    payment_method: pm.method,
                    amount: amount,
                    installments_count: 1,
                    installment_number: 1,
                    reference_number: formData.payment_reference || null,
                    check_number: pm.checkNumber || null,
                    credit_card_id: creditCardId,
                    due_date: dueDate,
                  });
                }
              }
            }
          }

        } else if (formData.document_type === 'summary') {
          // --- SUMMARY (מרכזת) ---
          const total = parseFloat(formData.total_amount);
          const subtotal = total / 1.17;
          const vatAmount = total - subtotal;
          const isClosed = formData.summary_is_closed === 'yes';

          const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
              business_id: formData.business_id,
              supplier_id: formData.supplier_id,
              invoice_date: formData.document_date,
              invoice_number: formData.document_number,
              subtotal: subtotal,
              vat_amount: vatAmount,
              total_amount: total,
              status: isClosed ? 'pending' : 'needs_review',
              invoice_type: 'current',
              is_consolidated: true,
              notes: formData.notes || null,
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (invoiceError) throw invoiceError;
          createdInvoiceId = invoice?.id || null;

          // Insert delivery notes linked to this invoice
          if (formData.summary_delivery_notes && formData.summary_delivery_notes.length > 0 && invoice) {
            const deliveryNotesData = formData.summary_delivery_notes.map(note => {
              const noteTotal = parseFloat(note.total_amount);
              const noteSubtotal = noteTotal / 1.17;
              const noteVat = noteTotal - noteSubtotal;
              return {
                invoice_id: invoice.id,
                business_id: formData.business_id,
                supplier_id: formData.supplier_id,
                delivery_note_number: note.delivery_note_number.trim(),
                delivery_date: note.delivery_date,
                subtotal: noteSubtotal,
                vat_amount: noteVat,
                total_amount: noteTotal,
                notes: note.notes?.trim() || null,
                is_verified: isClosed,
              };
            });

            const { error: notesError } = await supabase
              .from('delivery_notes')
              .insert(deliveryNotesData);

            if (notesError) {
              console.error('Error inserting delivery notes:', notesError);
            }
          }
        } else if (formData.document_type === 'daily_entry') {
          // --- DAILY ENTRY (רישום יומי) ---
          const { data: dailyEntry, error: dailyError } = await supabase
            .from('daily_entries')
            .insert({
              business_id: formData.business_id,
              entry_date: formData.daily_entry_date,
              total_register: parseFloat(formData.daily_total_register || '0') || 0,
              labor_cost: parseFloat(formData.daily_labor_cost || '0') || 0,
              labor_hours: parseFloat(formData.daily_labor_hours || '0') || 0,
              discounts: parseFloat(formData.daily_discounts || '0') || 0,
              day_factor: parseFloat(formData.daily_day_factor || '1') || 1,
              manager_daily_cost: 0,
              created_by: user?.id || null,
            })
            .select()
            .single();

          if (dailyError) {
            if (dailyError.code === '23505') {
              alert('כבר קיים רישום לתאריך זה');
              setIsLoading(false);
              return;
            }
            throw dailyError;
          }

          const dailyEntryId = dailyEntry.id;

          // Save income breakdown
          if (formData.daily_income_data) {
            for (const [sourceId, data] of Object.entries(formData.daily_income_data)) {
              const amount = parseFloat(data.amount) || 0;
              const ordersCount = parseInt(data.orders_count) || 0;
              if (amount > 0 || ordersCount > 0) {
                await supabase.from('daily_income_breakdown').insert({
                  daily_entry_id: dailyEntryId,
                  income_source_id: sourceId,
                  amount,
                  orders_count: ordersCount,
                });
              }
            }
          }

          // Save receipts
          if (formData.daily_receipt_data) {
            for (const [receiptId, val] of Object.entries(formData.daily_receipt_data)) {
              const amount = parseFloat(val) || 0;
              if (amount > 0) {
                await supabase.from('daily_receipts').insert({
                  daily_entry_id: dailyEntryId,
                  receipt_type_id: receiptId,
                  amount,
                });
              }
            }
          }

          // Save custom parameters
          if (formData.daily_parameter_data) {
            for (const [paramId, val] of Object.entries(formData.daily_parameter_data)) {
              const value = parseFloat(val) || 0;
              if (value > 0) {
                await supabase.from('daily_parameters').insert({
                  daily_entry_id: dailyEntryId,
                  parameter_id: paramId,
                  value,
                });
              }
            }
          }

          // Save managed products usage
          if (formData.daily_product_usage && formData.daily_managed_products) {
            for (const product of formData.daily_managed_products) {
              const usage = formData.daily_product_usage[product.id];
              if (usage) {
                const openingStock = parseFloat(usage.opening_stock) || 0;
                const receivedQty = parseFloat(usage.received_quantity) || 0;
                const closingStock = parseFloat(usage.closing_stock) || 0;
                if (openingStock > 0 || receivedQty > 0 || closingStock > 0) {
                  const quantityUsed = openingStock + receivedQty - closingStock;
                  await supabase.from('daily_product_usage').insert({
                    daily_entry_id: dailyEntryId,
                    product_id: product.id,
                    opening_stock: openingStock,
                    received_quantity: receivedQty,
                    closing_stock: closingStock,
                    quantity: quantityUsed,
                    unit_cost_at_time: product.unit_cost,
                  });
                  // Update current_stock
                  await supabase.from('managed_products').update({ current_stock: closingStock }).eq('id', product.id);
                }
              }
            }
          }
        }

        // --- PRICE TRACKING: save line item prices ---
        if (formData.line_items && formData.line_items.length > 0 && formData.supplier_id) {
          for (const li of formData.line_items) {
            if (!li.description || li.unit_price == null) continue;
            const itemName = li.description.trim();
            if (!itemName) continue;

            try {
              // Find or create supplier_item
              let supplierItemId = li.matched_supplier_item_id || null;

              if (!supplierItemId) {
                // Try to find existing item by name
                const { data: existing } = await supabase
                  .from('supplier_items')
                  .select('id, current_price')
                  .eq('business_id', formData.business_id)
                  .eq('supplier_id', formData.supplier_id)
                  .eq('item_name', itemName)
                  .maybeSingle();

                if (existing) {
                  supplierItemId = existing.id;
                } else {
                  // Create new supplier_item
                  const { data: newItem } = await supabase
                    .from('supplier_items')
                    .insert({
                      business_id: formData.business_id,
                      supplier_id: formData.supplier_id,
                      item_name: itemName,
                      current_price: li.unit_price,
                      last_price_date: formData.document_date,
                    })
                    .select('id')
                    .single();
                  if (newItem) supplierItemId = newItem.id;
                }
              }

              if (!supplierItemId) continue;

              // Get current price before updating
              const { data: currentItem } = await supabase
                .from('supplier_items')
                .select('current_price')
                .eq('id', supplierItemId)
                .single();

              const oldPrice = currentItem?.current_price;

              // Insert price record
              await supabase.from('supplier_item_prices').insert({
                supplier_item_id: supplierItemId,
                price: li.unit_price,
                quantity: li.quantity || null,
                invoice_id: createdInvoiceId || null,
                ocr_document_id: currentDocument.id,
                document_date: formData.document_date,
              });

              // Update current price on supplier_item
              await supabase.from('supplier_items').update({
                current_price: li.unit_price,
                last_price_date: formData.document_date,
                updated_at: new Date().toISOString(),
              }).eq('id', supplierItemId);

              // Create price alert if price changed
              if (oldPrice != null && Math.abs(li.unit_price - oldPrice) > 0.01) {
                const changePct = oldPrice > 0
                  ? ((li.unit_price - oldPrice) / oldPrice) * 100
                  : 0;
                await supabase.from('price_alerts').insert({
                  business_id: formData.business_id,
                  supplier_item_id: supplierItemId,
                  supplier_id: formData.supplier_id,
                  ocr_document_id: currentDocument.id,
                  old_price: oldPrice,
                  new_price: li.unit_price,
                  change_pct: Math.round(changePct * 100) / 100,
                  document_date: formData.document_date,
                });
              }
            } catch (priceError) {
              console.error('Error saving price for item:', itemName, priceError);
              // Continue with other items - don't fail the whole approval
            }
          }
        }

        // Update OCR document status in Supabase
        await supabase.from('ocr_documents').update({
          status: 'approved',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
          document_type: formData.document_type === 'summary' ? 'invoice' : formData.document_type,
          created_invoice_id: createdInvoiceId,
          created_payment_id: createdPaymentId,
          created_delivery_note_id: createdDeliveryNoteId,
        }).eq('id', currentDocument.id);

        // Re-fetch documents and move to next pending
        await fetchDocuments();
        setCurrentDocument(null);

      } catch (error) {
        console.error('Error saving document:', error);
        alert('שגיאה בשמירת המסמך');
      } finally {
        setIsLoading(false);
      }
    },
    [currentDocument, fetchDocuments]
  );

  // Handle document rejection
  const handleReject = useCallback(
    async (documentId: string, reason?: string) => {
      setIsLoading(true);

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // Update OCR document status in Supabase
        const { error } = await supabase.from('ocr_documents').update({
          status: 'rejected',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason || null,
        }).eq('id', documentId);

        if (error) throw error;

        // Re-fetch documents and move to next pending
        await fetchDocuments();
        setCurrentDocument(null);
      } catch (error) {
        console.error('Error rejecting document:', error);
        alert('שגיאה בדחיית המסמך');
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDocuments]
  );

  // Handle document deletion
  const handleDelete = useCallback(
    async (documentId: string) => {
      setIsLoading(true);
      try {
        const supabase = createClient();
        // Delete the document - all related records cascade automatically
        const { error } = await supabase.from('ocr_documents').delete().eq('id', documentId);
        if (error) throw error;

        await fetchDocuments();
        setCurrentDocument(null);
      } catch (error) {
        console.error('Error deleting document:', error);
        alert('שגיאה במחיקת המסמך');
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDocuments]
  );

  // Handle skip
  const handleSkip = useCallback(() => {
    if (!currentDocument) return;

    // Update local state
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, status: 'pending' as DocumentStatus } : doc
      )
    );

    // Revert status in Supabase (fire-and-forget)
    const supabase = createClient();
    supabase.from('ocr_documents').update({ status: 'pending' }).eq('id', currentDocument.id);

    const pendingDocs = documents.filter(
      (doc) => doc.status === 'pending' && doc.id !== currentDocument.id
    );
    if (pendingDocs.length > 0) {
      setCurrentDocument(pendingDocs[0]);
    }
  }, [currentDocument, documents]);

  // Handle crop
  const handleCrop = useCallback((croppedImageUrl: string) => {
    if (!currentDocument) return;

    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === currentDocument.id ? { ...doc, image_url: croppedImageUrl } : doc
      )
    );

    setCurrentDocument((prev) => (prev ? { ...prev, image_url: croppedImageUrl } : null));
  }, [currentDocument]);

  // Count pending documents
  const pendingCount = documents.filter((doc) => doc.status === 'pending').length;

  // NOW we can do early returns - after all hooks have been declared

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] bg-[#0a0d1f]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white/60 rounded-full animate-spin" />
          <span className="text-white/60">טוען...</span>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)] bg-[#0a0d1f]">
        <div className="flex flex-col items-center gap-4 text-white/60">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-lg">אין לך הרשאה לצפות בדף זה</p>
          <p className="text-sm">מפנה לדף הבית...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-[#0a0d1f]">
      {/* Page header - mobile only */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0F1535] border-b border-[#4C526B]">
        <h1 className="text-[18px] font-bold text-white">קליטת מסמכים OCR</h1>
        <span className="text-[14px] text-white/60">
          {pendingCount} ממתינים
        </span>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden flex border-b border-[#4C526B]">
        <Button
          onClick={() => setShowMobileViewer(true)}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            showMobileViewer
              ? 'text-white border-b-2 border-[#29318A]'
              : 'text-white/50 border-b-2 border-transparent'
          }`}
        >
          תמונת מסמך
        </Button>
        <Button
          onClick={() => setShowMobileViewer(false)}
          className={`flex-1 py-3 text-[14px] font-medium transition-colors ${
            !showMobileViewer
              ? 'text-white border-b-2 border-[#29318A]'
              : 'text-white/50 border-b-2 border-transparent'
          }`}
        >
          פרטי מסמך
        </Button>
      </div>

      {/* Main content area - 3 columns on desktop (RTL: DOM order = visual right-to-left) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        {/* Document Queue - Right side (desktop) */}
        <div id="onboarding-ocr-queue" className="hidden lg:block lg:w-[240px] overflow-hidden lg:border-l border-[#4C526B]">
          <DocumentQueue
            documents={documents}
            currentDocumentId={currentDocument?.id || null}
            onSelectDocument={handleSelectDocument}
            filterStatus={filterStatus}
            onFilterChange={setFilterStatus}
            vertical={true}
          />
        </div>

        {/* Document Viewer - Center (desktop) / Tab 1 (mobile) */}
        <div
          id="onboarding-ocr-upload"
          className={`lg:flex-1 lg:block ${
            showMobileViewer ? 'flex-1' : 'hidden'
          }`}
          style={{ minHeight: 0, overflow: 'hidden', height: '100%' }}
        >
          {currentDocument ? (
            <DocumentViewer
              key={currentDocument.image_url}
              imageUrl={currentDocument.image_url}
              fileType={currentDocument.file_type}
              onCrop={handleCrop}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-white/60 px-6">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="mt-4 text-lg">אין מסמך להצגה</p>
              <p className="mt-1 text-sm">בחר מסמך מהתור</p>
            </div>
          )}
        </div>

        {/* OCR Form - Left side (desktop) / Tab 2 (mobile) */}
        <div
          id="onboarding-ocr-form"
          className={`lg:w-[420px] lg:block ${
            !showMobileViewer ? 'flex-1' : 'hidden'
          } lg:border-r border-[#4C526B] overflow-hidden`}
        >
          <OCRForm
            document={currentDocument}
            suppliers={suppliers}
            coordinatorSuppliers={coordinatorSuppliers}
            businesses={businesses}
            selectedBusinessId={selectedBusinessId}
            onBusinessChange={setSelectedBusinessId}
            onApprove={handleApprove}
            onReject={handleReject}
            onDelete={handleDelete}
            onSkip={handleSkip}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Document Queue - Bottom (mobile only) */}
      <div className="lg:hidden">
        <DocumentQueue
          documents={documents}
          currentDocumentId={currentDocument?.id || null}
          onSelectDocument={handleSelectDocument}
          filterStatus={filterStatus}
          onFilterChange={setFilterStatus}
          vertical={false}
        />
      </div>
    </div>
  );
}
