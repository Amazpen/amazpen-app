"use client";

import { useState, useEffect, useRef, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { convertPdfToImage } from "@/lib/pdfToImage";
import { useFormDraft } from "@/hooks/useFormDraft";
import { generateUUID } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Format number with commas (e.g., 1000 -> 1,000)
const formatNumberWithCommas = (num: number): string => {
  return num.toLocaleString("he-IL");
};

// Parse number from formatted string (e.g., "1,000" -> 1000)
const parseFormattedNumber = (str: string): number => {
  return parseFloat(str.replace(/,/g, "")) || 0;
};

// Business types
const businessTypes = [
  { id: "restaurant", label: "מסעדה" },
  { id: "cafe", label: "בית קפה" },
  { id: "retail", label: "קמעונאות" },
  { id: "services", label: "שירותים" },
  { id: "manufacturing", label: "ייצור" },
  { id: "municipality", label: "עירייה" },
  { id: "other", label: "אחר" },
];

// Days of week for schedule
const daysOfWeek = [
  { id: 0, label: "ראשון", short: "א'" },
  { id: 1, label: "שני", short: "ב'" },
  { id: 2, label: "שלישי", short: "ג'" },
  { id: 3, label: "רביעי", short: "ד'" },
  { id: 4, label: "חמישי", short: "ה'" },
  { id: 5, label: "שישי", short: "ו'" },
  { id: 6, label: "שבת", short: "ש'" },
];

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditBusinessPage({ params }: PageProps) {
  const { id: businessId } = use(params);
  const router = useRouter();
  const { showToast } = useToast();

  // Draft persistence
  const { saveDraft, restoreDraft, clearDraft } = useFormDraft(`editBusiness:draft:${businessId}`);
  const draftRestored = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  // Business status
  const [businessStatus, setBusinessStatus] = useState<"active" | "inactive">("active");
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);

  // Step 1: Basic Info
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [customBusinessType, setCustomBusinessType] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null);
  const [managerSalary, setManagerSalary] = useState<number>(0);
  const [markupPercentage, setMarkupPercentage] = useState<number>(18);
  const [vatPercentage, setVatPercentage] = useState<number>(18);

  // Step 2: Business Schedule
  const [schedule, setSchedule] = useState<Record<number, string>>({
    0: "1",
    1: "1",
    2: "1",
    3: "1",
    4: "1",
    5: "0.5",
    6: "0",
  });

  // Step 3: Income Sources, Receipt Types, Custom Parameters
  const [incomeSources, setIncomeSources] = useState<{ id?: string; name: string }[]>([]);
  const [newIncomeSource, setNewIncomeSource] = useState("");

  const [receiptTypes, setReceiptTypes] = useState<{ id?: string; name: string }[]>([]);
  const [newReceiptType, setNewReceiptType] = useState("");

  const [customParameters, setCustomParameters] = useState<{ id?: string; name: string }[]>([]);
  const [newCustomParameter, setNewCustomParameter] = useState("");

  // Credit Cards
  interface CreditCard {
    id?: string;
    cardName: string;
    billingDay: number;
  }
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [newCardName, setNewCardName] = useState("");
  const [newBillingDay, setNewBillingDay] = useState<number>(10);

  // Managed Products
  interface ManagedProduct {
    id?: string;
    name: string;
    unit: string;
    unitCost: number;
  }
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);
  const [newProductName, setNewProductName] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("");
  const [newProductCost, setNewProductCost] = useState<number>(0);

  // Step 4: Team Members
  interface TeamMember {
    id?: string;
    email: string;
    name: string;
    password?: string;
    phone: string;
    avatar_url: string;
    role: "owner" | "employee";
    isExisting?: boolean;
  }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberAvatarUrl, setNewMemberAvatarUrl] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"owner" | "employee">("employee");
  const [isUploadingMemberAvatar, setIsUploadingMemberAvatar] = useState(false);
  const memberAvatarInputRef = useRef<HTMLInputElement>(null);

  // Load existing business data
  useEffect(() => {
    const loadBusinessData = async () => {
      setIsLoading(true);
      const supabase = createClient();

      // Check if user is admin first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      const userIsAdmin = profile?.is_admin === true;
      setIsAdmin(userIsAdmin);

      if (!userIsAdmin) {
        setIsLoading(false);
        return;
      }

      // Fetch business data
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", businessId)
        .single();

      if (businessError || !business) {
        console.error("Error fetching business:", businessError);
        showToast("שגיאה בטעינת העסק", "error");
        router.push("/admin/business/edit");
        return;
      }

      // Set status
      setBusinessStatus(business.status === "inactive" ? "inactive" : "active");

      // Set basic info
      setBusinessName(business.name || "");
      const typeExists = businessTypes.some(t => t.id === business.business_type);
      if (typeExists) {
        setBusinessType(business.business_type || "");
      } else if (business.business_type) {
        setBusinessType("other");
        setCustomBusinessType(business.business_type);
      }
      setTaxId(business.tax_id || "");
      setAddress(business.address || "");
      setCity(business.city || "");
      setPhone(business.phone || "");
      setEmail(business.email || "");
      setExistingLogoUrl(business.logo_url || null);
      setLogoPreview(business.logo_url || null);
      setManagerSalary(business.manager_monthly_salary || 0);
      setMarkupPercentage(business.markup_percentage ? Math.round((business.markup_percentage - 1) * 100) : 0);
      setVatPercentage(business.vat_percentage ? Math.round(business.vat_percentage * 100) : 18);

      // Fetch schedule
      const { data: scheduleData } = await supabase
        .from("business_schedule")
        .select("day_of_week, day_factor")
        .eq("business_id", businessId);

      if (scheduleData) {
        const newSchedule: Record<number, string> = {};
        scheduleData.forEach((s) => {
          newSchedule[s.day_of_week] = s.day_factor.toString();
        });
        if (Object.keys(newSchedule).length > 0) {
          setSchedule(newSchedule);
        }
      }

      // Fetch income sources
      const { data: incomeData } = await supabase
        .from("income_sources")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("display_order");

      if (incomeData) {
        setIncomeSources(incomeData.map(i => ({ id: i.id, name: i.name })));
      }

      // Fetch receipt types
      const { data: receiptData } = await supabase
        .from("receipt_types")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("display_order");

      if (receiptData) {
        setReceiptTypes(receiptData.map(r => ({ id: r.id, name: r.name })));
      }

      // Fetch custom parameters
      const { data: paramData } = await supabase
        .from("custom_parameters")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("display_order");

      if (paramData) {
        setCustomParameters(paramData.map(p => ({ id: p.id, name: p.name })));
      }

      // Fetch credit cards
      const { data: cardData } = await supabase
        .from("business_credit_cards")
        .select("id, card_name, billing_day")
        .eq("business_id", businessId)
        .eq("is_active", true);

      if (cardData) {
        setCreditCards(cardData.map(c => ({ id: c.id, cardName: c.card_name, billingDay: c.billing_day })));
      }

      // Fetch managed products
      const { data: productData } = await supabase
        .from("managed_products")
        .select("id, name, unit, unit_cost")
        .eq("business_id", businessId)
        .eq("is_active", true);

      if (productData) {
        setManagedProducts(productData.map(p => ({ id: p.id, name: p.name, unit: p.unit, unitCost: p.unit_cost })));
      }

      // Fetch team members
      const { data: memberData } = await supabase
        .from("business_members")
        .select(`
          id,
          role,
          user:profiles(id, email, full_name, phone, avatar_url)
        `)
        .eq("business_id", businessId)
        .not("joined_at", "is", null);

      if (memberData) {
        setTeamMembers(memberData.map(m => {
          const user = m.user as unknown as { id: string; email: string; full_name: string | null; phone: string | null; avatar_url: string | null };
          return {
            id: m.id,
            email: user?.email || "",
            name: user?.full_name || "",
            phone: user?.phone || "",
            avatar_url: user?.avatar_url || "",
            role: m.role as "owner" | "employee",
            isExisting: true,
          };
        }));
      }

      setIsLoading(false);

      // Restore draft after data loads (user edits override loaded data)
      draftRestored.current = false;
      setTimeout(() => {
        const draft = restoreDraft();
        if (draft) {
          if (draft.currentStep) setCurrentStep(draft.currentStep as number);
          if (draft.businessName) setBusinessName(draft.businessName as string);
          if (draft.businessType) setBusinessType(draft.businessType as string);
          if (draft.customBusinessType) setCustomBusinessType(draft.customBusinessType as string);
          if (draft.taxId) setTaxId(draft.taxId as string);
          if (draft.address) setAddress(draft.address as string);
          if (draft.city) setCity(draft.city as string);
          if (draft.phone) setPhone(draft.phone as string);
          if (draft.email) setEmail(draft.email as string);
          if (draft.managerSalary !== undefined) setManagerSalary(draft.managerSalary as number);
          if (draft.markupPercentage !== undefined) setMarkupPercentage(draft.markupPercentage as number);
          if (draft.vatPercentage !== undefined) setVatPercentage(draft.vatPercentage as number);
          if (draft.schedule) setSchedule(draft.schedule as Record<number, string>);
          if (draft.incomeSources) setIncomeSources(draft.incomeSources as typeof incomeSources);
          if (draft.receiptTypes) setReceiptTypes(draft.receiptTypes as typeof receiptTypes);
          if (draft.customParameters) setCustomParameters(draft.customParameters as typeof customParameters);
          if (draft.creditCards) setCreditCards(draft.creditCards as CreditCard[]);
          if (draft.managedProducts) setManagedProducts(draft.managedProducts as ManagedProduct[]);
        }
        draftRestored.current = true;
      }, 0);
    };

    loadBusinessData();
  }, [businessId, router, restoreDraft, showToast]);

  // Save draft on form changes
  const saveDraftData = useCallback(() => {
    if (isLoading) return;
    saveDraft({
      currentStep,
      businessName, businessType, customBusinessType, taxId, address, city, phone, email,
      managerSalary, markupPercentage, vatPercentage,
      schedule,
      incomeSources, receiptTypes, customParameters, creditCards, managedProducts,
    });
  }, [saveDraft, isLoading, currentStep,
    businessName, businessType, customBusinessType, taxId, address, city, phone, email,
    managerSalary, markupPercentage, vatPercentage,
    schedule, incomeSources, receiptTypes, customParameters, creditCards, managedProducts]);

  useEffect(() => {
    if (draftRestored.current) {
      saveDraftData();
    }
  }, [saveDraftData]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddIncomeSource = () => {
    if (newIncomeSource.trim() && !incomeSources.some(s => s.name === newIncomeSource.trim())) {
      setIncomeSources([...incomeSources, { name: newIncomeSource.trim() }]);
      setNewIncomeSource("");
    }
  };

  const handleRemoveIncomeSource = (index: number) => {
    setIncomeSources(incomeSources.filter((_, i) => i !== index));
  };

  const handleAddReceiptType = () => {
    if (newReceiptType.trim() && !receiptTypes.some(t => t.name === newReceiptType.trim())) {
      setReceiptTypes([...receiptTypes, { name: newReceiptType.trim() }]);
      setNewReceiptType("");
    }
  };

  const handleRemoveReceiptType = (index: number) => {
    setReceiptTypes(receiptTypes.filter((_, i) => i !== index));
  };

  const handleAddCustomParameter = () => {
    if (newCustomParameter.trim() && !customParameters.some(p => p.name === newCustomParameter.trim())) {
      setCustomParameters([...customParameters, { name: newCustomParameter.trim() }]);
      setNewCustomParameter("");
    }
  };

  const handleRemoveCustomParameter = (index: number) => {
    setCustomParameters(customParameters.filter((_, i) => i !== index));
  };

  const handleAddCreditCard = () => {
    if (newCardName.trim() && newBillingDay >= 1 && newBillingDay <= 31) {
      setCreditCards([...creditCards, { cardName: newCardName.trim(), billingDay: newBillingDay }]);
      setNewCardName("");
      setNewBillingDay(10);
    }
  };

  const handleRemoveCreditCard = (index: number) => {
    setCreditCards(creditCards.filter((_, i) => i !== index));
  };

  const handleAddManagedProduct = () => {
    if (newProductName.trim() && newProductUnit.trim() && newProductCost >= 0) {
      setManagedProducts([...managedProducts, {
        name: newProductName.trim(),
        unit: newProductUnit.trim(),
        unitCost: newProductCost
      }]);
      setNewProductName("");
      setNewProductUnit("");
      setNewProductCost(0);
    }
  };

  const handleRemoveManagedProduct = (index: number) => {
    setManagedProducts(managedProducts.filter((_, i) => i !== index));
  };

  // Handle member avatar upload
  const handleMemberAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("יש להעלות קובץ תמונה בלבד", "warning");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast("גודל התמונה המקסימלי הוא 2MB", "warning");
      return;
    }

    setIsUploadingMemberAvatar(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `avatars/${generateUUID()}-${Date.now()}.${fileExt}`;

      const result = await uploadFile(file, fileName, "assets");

      if (!result.success) {
        console.error("Error uploading avatar:", result.error);
        showToast("שגיאה בהעלאת התמונה", "error");
        return;
      }

      setNewMemberAvatarUrl(result.publicUrl || "");
    } catch (err) {
      console.error("Error uploading avatar:", err);
      showToast("שגיאה בהעלאת התמונה", "error");
    } finally {
      setIsUploadingMemberAvatar(false);
    }
  };

  const handleAddTeamMember = () => {
    if (!newMemberEmail.trim()) return;
    if (!newMemberPassword.trim() || newMemberPassword.length < 6) {
      showToast("הסיסמה חייבת להכיל לפחות 6 תווים", "warning");
      return;
    }
    if (teamMembers.some(m => m.email.toLowerCase() === newMemberEmail.trim().toLowerCase())) {
      showToast("משתמש עם אימייל זה כבר נוסף", "warning");
      return;
    }

    setTeamMembers([...teamMembers, {
      email: newMemberEmail.trim().toLowerCase(),
      name: newMemberName.trim(),
      password: newMemberPassword,
      phone: newMemberPhone.trim(),
      avatar_url: newMemberAvatarUrl,
      role: newMemberRole,
      isExisting: false,
    }]);
    setNewMemberEmail("");
    setNewMemberName("");
    setNewMemberPassword("");
    setNewMemberPhone("");
    setNewMemberAvatarUrl("");
  };

  const handleRemoveTeamMember = (index: number) => {
    setTeamMembers(teamMembers.filter((_, i) => i !== index));
  };

  // Toggle business status (active/inactive)
  const handleToggleStatus = async () => {
    setIsTogglingStatus(true);
    const supabase = createClient();
    const newStatus = businessStatus === "active" ? "inactive" : "active";

    const { error } = await supabase
      .from("businesses")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", businessId);

    if (error) {
      showToast("שגיאה בעדכון סטטוס העסק", "error");
    } else {
      setBusinessStatus(newStatus);
      showToast(
        newStatus === "active" ? "העסק הופעל מחדש בהצלחה" : "העסק הפך ללא פעיל",
        "success"
      );
    }
    setIsTogglingStatus(false);
    setShowStatusConfirm(false);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const supabase = createClient();

    try {
      // 1. Upload new logo if provided
      let logoUrl: string | null = existingLogoUrl;
      if (logoFile) {
        // Convert PDF to PNG if needed
        let fileToUpload = logoFile;
        if (logoFile.type === "application/pdf") {
          try {
            fileToUpload = await convertPdfToImage(logoFile);
          } catch (conversionError) {
            console.error("PDF conversion error:", conversionError);
            // Continue with original file if conversion fails
          }
        }

        const fileExt = fileToUpload.name.split(".").pop();
        const fileName = `${generateUUID()}.${fileExt}`;
        const filePath = `business-logos/${fileName}`;

        const result = await uploadFile(fileToUpload, filePath, "assets");

        if (!result.success) {
          console.error("Logo upload error:", result.error);
        } else {
          logoUrl = result.publicUrl || null;
        }
      }

      // 2. Update business record
      const { error: businessError } = await supabase
        .from("businesses")
        .update({
          name: businessName,
          business_type: businessType === "other" ? customBusinessType.trim() : businessType,
          tax_id: taxId || null,
          address: address || null,
          city: city || null,
          phone: phone || null,
          email: email || null,
          logo_url: logoUrl,
          manager_monthly_salary: managerSalary,
          markup_percentage: 1 + markupPercentage / 100,
          vat_percentage: vatPercentage / 100,
        })
        .eq("id", businessId);

      if (businessError) {
        throw new Error(`שגיאה בעדכון העסק: ${businessError.message}`);
      }

      // 3. Update business schedule
      for (const [dayOfWeek, dayFactor] of Object.entries(schedule)) {
        await supabase
          .from("business_schedule")
          .upsert({
            business_id: businessId,
            day_of_week: parseInt(dayOfWeek),
            day_factor: parseFloat(dayFactor),
          }, { onConflict: "business_id,day_of_week" });
      }

      // 4. Update income sources - delete removed, insert new
      const existingIncomeIds = incomeSources.filter(s => s.id).map(s => s.id);
      if (existingIncomeIds.length > 0) {
        await supabase
          .from("income_sources")
          .update({ is_active: false })
          .eq("business_id", businessId)
          .not("id", "in", `(${existingIncomeIds.join(",")})`);
      } else {
        // Deactivate all if none are kept
        await supabase
          .from("income_sources")
          .update({ is_active: false })
          .eq("business_id", businessId);
      }

      const newIncomeSources = incomeSources.filter(s => !s.id);
      if (newIncomeSources.length > 0) {
        await supabase.from("income_sources").insert(
          newIncomeSources.map((s, i) => ({
            business_id: businessId,
            name: s.name,
            display_order: incomeSources.length + i,
            is_active: true,
          }))
        );
      }

      // 5. Update receipt types
      const existingReceiptIds = receiptTypes.filter(t => t.id).map(t => t.id);
      if (existingReceiptIds.length > 0) {
        await supabase
          .from("receipt_types")
          .update({ is_active: false })
          .eq("business_id", businessId)
          .not("id", "in", `(${existingReceiptIds.join(",")})`);
      } else {
        // Deactivate all if none are kept
        await supabase
          .from("receipt_types")
          .update({ is_active: false })
          .eq("business_id", businessId);
      }

      const newReceiptTypes = receiptTypes.filter(t => !t.id);
      if (newReceiptTypes.length > 0) {
        await supabase.from("receipt_types").insert(
          newReceiptTypes.map((t, i) => ({
            business_id: businessId,
            name: t.name,
            display_order: receiptTypes.length + i,
            is_active: true,
          }))
        );
      }

      // 6. Update custom parameters
      const existingParamIds = customParameters.filter(p => p.id).map(p => p.id);
      if (existingParamIds.length > 0) {
        await supabase
          .from("custom_parameters")
          .update({ is_active: false })
          .eq("business_id", businessId)
          .not("id", "in", `(${existingParamIds.join(",")})`);
      } else {
        // Deactivate all if none are kept
        await supabase
          .from("custom_parameters")
          .update({ is_active: false })
          .eq("business_id", businessId);
      }

      const newParams = customParameters.filter(p => !p.id);
      if (newParams.length > 0) {
        await supabase.from("custom_parameters").insert(
          newParams.map((p, i) => ({
            business_id: businessId,
            name: p.name,
            display_order: customParameters.length + i,
            is_active: true,
          }))
        );
      }

      // 7. Update credit cards
      const existingCardIds = creditCards.filter(c => c.id).map(c => c.id);
      if (existingCardIds.length > 0) {
        await supabase
          .from("business_credit_cards")
          .update({ is_active: false })
          .eq("business_id", businessId)
          .not("id", "in", `(${existingCardIds.join(",")})`);
      } else {
        // Deactivate all if none are kept
        await supabase
          .from("business_credit_cards")
          .update({ is_active: false })
          .eq("business_id", businessId);
      }

      const newCards = creditCards.filter(c => !c.id);
      if (newCards.length > 0) {
        await supabase.from("business_credit_cards").insert(
          newCards.map(c => ({
            business_id: businessId,
            card_name: c.cardName,
            billing_day: c.billingDay,
            is_active: true,
          }))
        );
      }

      // 8. Update managed products
      const existingProductIds = managedProducts.filter(p => p.id).map(p => p.id);
      if (existingProductIds.length > 0) {
        await supabase
          .from("managed_products")
          .update({ is_active: false })
          .eq("business_id", businessId)
          .not("id", "in", `(${existingProductIds.join(",")})`);
      } else {
        // Deactivate all if none are kept
        await supabase
          .from("managed_products")
          .update({ is_active: false })
          .eq("business_id", businessId);
      }

      // Update existing products (unit + unit_cost)
      const existingProducts = managedProducts.filter(p => p.id);
      for (const p of existingProducts) {
        await supabase
          .from("managed_products")
          .update({ unit: p.unit, unit_cost: p.unitCost, updated_at: new Date().toISOString() })
          .eq("id", p.id);
      }

      const newProducts = managedProducts.filter(p => !p.id);
      if (newProducts.length > 0) {
        await supabase.from("managed_products").insert(
          newProducts.map(p => ({
            business_id: businessId,
            name: p.name,
            unit: p.unit,
            unit_cost: p.unitCost,
            is_active: true,
          }))
        );
      }

      // 9. Handle team members - remove deleted, add new
      const existingMemberIds = teamMembers.filter(m => m.id && m.isExisting).map(m => m.id);
      const { data: currentMembers } = await supabase
        .from("business_members")
        .select("id")
        .eq("business_id", businessId);

      const membersToRemove = currentMembers?.filter(cm => !existingMemberIds.includes(cm.id)) || [];
      for (const member of membersToRemove) {
        await supabase
          .from("business_members")
          .update({ joined_at: null })
          .eq("id", member.id);
      }

      // Add new members
      const newMembers = teamMembers.filter(m => !m.isExisting);
      for (const member of newMembers) {
        // Check if user exists
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("id, email")
          .eq("email", member.email)
          .maybeSingle();

        if (existingProfile) {
          // User exists - create membership
          await supabase
            .from("business_members")
            .insert({
              business_id: businessId,
              user_id: existingProfile.id,
              role: member.role,
              joined_at: new Date().toISOString(),
            });
        } else {
          // Create new user via API
          try {
            const response = await fetch("/api/admin/create-user", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: member.email,
                password: member.password,
                fullName: member.name,
                phone: member.phone,
                avatarUrl: member.avatar_url,
                businessId: businessId,
                role: member.role,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              console.error(`Failed to create user ${member.email}:`, errorData.error);
            }
          } catch (err) {
            console.error(`Error creating user ${member.email}:`, err);
          }
        }
      }

      clearDraft();
      showToast("העסק עודכן בהצלחה!", "success");
      router.push("/");
    } catch (error) {
      console.error("Error updating business:", error);
      showToast(error instanceof Error ? error.message : "שגיאה בעדכון העסק. נסה שוב.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep1 = businessName.trim() && businessType && (businessType !== "other" || customBusinessType.trim()) && taxId.trim();
  const canProceedStep2 = true;
  const canProceedStep3 = incomeSources.length > 0;
  const hasOwner = teamMembers.some(m => m.role === "owner");
  const canSubmit = hasOwner;

  if (isLoading) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] text-white">
        <svg className="animate-spin h-10 w-10 text-[#4956D4] mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-[16px] text-white/60">טוען נתוני עסק...</p>
      </div>
    );
  }

  const renderStep1 = () => (
    <div className="flex flex-col gap-[15px]">
      {/* Business Name */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">
          <span className="text-[#F64E60]">*</span> שם העסק
        </label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="הכנס שם עסק"
            className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Business Type */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">
          <span className="text-[#F64E60]">*</span> סוג עסק
        </label>
        <Select value={businessType || "__none__"} onValueChange={(val) => { const v = val === "__none__" ? "" : val; setBusinessType(v); if (v !== "other") { setCustomBusinessType(""); } }}>
          <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
            <SelectValue placeholder="בחר סוג עסק" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">בחר סוג עסק</SelectItem>
            {businessTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Custom Business Type */}
      {businessType === "other" && (
        <div className="flex flex-col gap-[5px]">
          <label className="text-[15px] font-medium text-white text-right">
            <span className="text-[#F64E60]">*</span> שם סוג העסק
          </label>
          <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
            <Input
              type="text"
              value={customBusinessType}
              onChange={(e) => setCustomBusinessType(e.target.value)}
              placeholder="הכנס סוג עסק מותאם אישית"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
            />
          </div>
        </div>
      )}

      {/* Tax ID */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">
          <span className="text-[#F64E60]">*</span> מספר עוסק / ח.פ
        </label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="לדוגמה: 515678901"
            className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Address */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">כתובת</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="רחוב ומספר"
            className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
          />
        </div>
      </div>

      {/* City */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">עיר</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
          <Input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="שם העיר"
            className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Phone & Email Row */}
      <div className="grid grid-cols-2 gap-[10px]">
        <div className="flex flex-col gap-[5px]">
          <label className="text-[15px] font-medium text-white text-right">טלפון</label>
          <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-0000000"
              className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
            />
          </div>
        </div>
        <div className="flex flex-col gap-[5px]">
          <label className="text-[15px] font-medium text-white text-right">אימייל</label>
          <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
            />
          </div>
        </div>
      </div>

      {/* Manager Salary */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">שכר מנהל חודשי</label>
        <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center">
          <Input
            type="text"
            inputMode="numeric"
            value={managerSalary === 0 ? "" : formatNumberWithCommas(managerSalary)}
            onChange={(e) => setManagerSalary(parseFormattedNumber(e.target.value))}
            placeholder="0"
            className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
          />
          <span className="text-white/50 text-[14px] pl-[10px]">₪</span>
        </div>
      </div>

      {/* Markup & VAT Row */}
      <div className="grid grid-cols-2 gap-[10px]">
        <div className="flex flex-col gap-[5px]">
          <label className="text-[15px] font-medium text-white text-right">אחוז העמסה</label>
          <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center">
            <span className="text-white/50 text-[14px] pr-[10px]">%</span>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={markupPercentage}
              onChange={(e) => setMarkupPercentage(parseFloat(e.target.value) || 0)}
              placeholder="1"
              className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
        <div className="flex flex-col gap-[5px]">
          <label className="text-[15px] font-medium text-white text-right">אחוז מע&quot;מ</label>
          <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center">
            <span className="text-white/50 text-[14px] pr-[10px]">%</span>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={vatPercentage}
              onChange={(e) => setVatPercentage(parseFloat(e.target.value) || 18)}
              placeholder="18"
              className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>

      {/* Logo Upload */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[15px] font-medium text-white text-right">לוגו העסק</label>
        <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[120px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#29318A] transition-colors">
          {logoPreview ? (
            <div className="relative">
              {logoFile?.type === 'application/pdf' ? (
                /* PDF preview - will be converted to PNG on upload */
                <div className="flex flex-col items-center gap-2">
                  <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#3CD856" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                    <polyline points="14,2 14,8 20,8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M9 15h6M9 11h6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-[12px] text-white/70">{logoFile.name}</span>
                  <span className="text-[10px] text-green-400">יומר לתמונה בעת השמירה</span>
                </div>
              ) : (
                <Image src={logoPreview} alt="Logo preview" className="max-h-[80px] max-w-[150px] object-contain rounded-[5px]" width={150} height={80} unoptimized />
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setLogoFile(null);
                  setLogoPreview(null);
                  setExistingLogoUrl(null);
                }}
                className="absolute -top-2 -right-2 w-[24px] h-[24px] bg-[#F64E60] rounded-full flex items-center justify-center text-white"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
            </div>
          ) : (
            <>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                <path d="M4 16L8.586 11.414C9.367 10.633 10.633 10.633 11.414 11.414L16 16M14 14L15.586 12.414C16.367 11.633 17.633 11.633 18.414 12.414L20 14M14 8H14.01M6 20H18C19.105 20 20 19.105 20 18V6C20 4.895 19.105 4 18 4H6C4.895 4 4 4.895 4 6V18C4 19.105 4.895 20 6 20Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[14px] text-[#979797]">לחץ להעלאת לוגו</span>
              <span className="text-[12px] text-[#979797]/60">PNG, JPG, PDF עד 2MB</span>
            </>
          )}
          <input
            type="file"
            onChange={handleLogoChange}
            className="hidden"
            accept="image/png,image/jpeg,image/jpg,application/pdf"
          />
        </label>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="flex flex-col gap-[15px]">
      <div className="text-center mb-[10px]">
        <p className="text-[14px] text-white/70">
          הגדר את ימי הפעילות של העסק. זה ישפיע על חישוב דוחות רווח והפסד.
        </p>
      </div>

      {/* Schedule Grid */}
      <div className="bg-[#29318A]/30 rounded-[15px] p-[8px]">
        <div className="grid grid-cols-7 gap-[5px]">
          {daysOfWeek.map((day) => (
            <div key={day.id} className="flex flex-col items-center gap-[8px]">
              <span className="text-[12px] font-bold text-white">{day.short}</span>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={schedule[day.id]}
                onChange={(e) => setSchedule({ ...schedule, [day.id]: e.target.value })}
                aria-label={`מקדם פעילות יום ${day.label}`}
                title={`הזן מקדם פעילות ליום ${day.label} (0-1)`}
                className="w-full h-[40px] bg-[#0F1535] text-white text-[14px] text-center rounded-[8px] border border-[#4C526B] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-[15px] flex-wrap">
        <div className="flex items-center gap-[5px]">
          <div className="w-[12px] h-[12px] rounded-full bg-[#3CD856]"></div>
          <span className="text-[12px] text-white/70">יום מלא (1)</span>
        </div>
        <div className="flex items-center gap-[5px]">
          <div className="w-[12px] h-[12px] rounded-full bg-[#4956D4]"></div>
          <span className="text-[12px] text-white/70">חצי יום (0.5)</span>
        </div>
        <div className="flex items-center gap-[5px]">
          <div className="w-[12px] h-[12px] rounded-full bg-[#F64E60]"></div>
          <span className="text-[12px] text-white/70">סגור (0)</span>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-[#0F1535] rounded-[10px] p-[8px]">
        <div className="flex items-center justify-between">
          <span className="text-[14px] text-white">סה&quot;כ ימי עבודה בשבוע:</span>
          <span className="text-[16px] font-bold text-[#3CD856]">
            {Object.values(schedule).reduce((sum, val) => sum + parseFloat(val || "0"), 0).toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="flex flex-col gap-[10px]">
      {/* Section 1: Income Sources */}
      <div className="bg-[#4956D4]/20 rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מקורות הכנסה</h3>
        <p className="text-[12px] text-white/50 text-right mb-[10px]">קופה, 10ביס, וולט וכו&apos;</p>

        <div className="flex gap-[10px] mb-[10px]">
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={handleAddIncomeSource}
            disabled={!newIncomeSource.trim()}
            className="bg-[#4956D4] text-white text-[14px] font-semibold px-[15px] py-[10px] rounded-[8px] disabled:opacity-50"
          >
            הוסף
          </Button>
          <div className="flex-1 border border-[#4C526B] rounded-[8px] h-[42px]">
            <Input
              type="text"
              value={newIncomeSource}
              onChange={(e) => setNewIncomeSource(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddIncomeSource()}
              placeholder="שם מקור הכנסה"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[8px] border-none outline-none px-[12px] placeholder:text-white/30"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-[8px]">
          {incomeSources.map((source, index) => (
            <div key={source.id || index} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveIncomeSource(index)}
                aria-label={`הסר ${source.name}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{source.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Receipt Types */}
      <div className="bg-[#4956D4]/20 rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">תקבולים</h3>
        <p className="text-[12px] text-white/50 text-right mb-[10px]">סוגי תקבולים שונים</p>

        <div className="flex gap-[10px] mb-[10px]">
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={handleAddReceiptType}
            disabled={!newReceiptType.trim()}
            className="bg-[#4956D4] text-white text-[14px] font-semibold px-[15px] py-[10px] rounded-[8px] disabled:opacity-50"
          >
            הוסף
          </Button>
          <div className="flex-1 border border-[#4C526B] rounded-[8px] h-[42px]">
            <Input
              type="text"
              value={newReceiptType}
              onChange={(e) => setNewReceiptType(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddReceiptType()}
              placeholder="שם תקבול"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[8px] border-none outline-none px-[12px] placeholder:text-white/30"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-[8px]">
          {receiptTypes.map((type, index) => (
            <div key={type.id || index} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveReceiptType(index)}
                aria-label={`הסר ${type.name}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{type.name}</span>
            </div>
          ))}
          {receiptTypes.length === 0 && (
            <span className="text-[12px] text-white/30">אין תקבולים</span>
          )}
        </div>
      </div>

      {/* Section 3: Custom Parameters */}
      <div className="bg-[#4956D4]/20 rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">פרמטרים נוספים</h3>
        <p className="text-[12px] text-white/50 text-right mb-[10px]">פרמטרים מותאמים אישית</p>

        <div className="flex gap-[10px] mb-[10px]">
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={handleAddCustomParameter}
            disabled={!newCustomParameter.trim()}
            className="bg-[#4956D4] text-white text-[14px] font-semibold px-[15px] py-[10px] rounded-[8px] disabled:opacity-50"
          >
            הוסף
          </Button>
          <div className="flex-1 border border-[#4C526B] rounded-[8px] h-[42px]">
            <Input
              type="text"
              value={newCustomParameter}
              onChange={(e) => setNewCustomParameter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCustomParameter()}
              placeholder="שם פרמטר"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[8px] border-none outline-none px-[12px] placeholder:text-white/30"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-[8px]">
          {customParameters.map((param, index) => (
            <div key={param.id || index} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveCustomParameter(index)}
                aria-label={`הסר ${param.name}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{param.name}</span>
            </div>
          ))}
          {customParameters.length === 0 && (
            <span className="text-[12px] text-white/30">אין פרמטרים</span>
          )}
        </div>
      </div>

      {/* Section 4: Credit Cards */}
      <div className="bg-[#4956D4]/20 rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">כרטיסי אשראי</h3>
        <p className="text-[12px] text-white/50 text-right mb-[10px]">כרטיסי אשראי של העסק</p>

        <div className="flex gap-[10px] mb-[10px]">
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={handleAddCreditCard}
            disabled={!newCardName.trim()}
            className="bg-[#4956D4] text-white text-[14px] font-semibold px-[15px] py-[10px] rounded-[8px] disabled:opacity-50"
          >
            הוסף
          </Button>
          <div className="w-[80px] border border-[#4C526B] rounded-[8px] h-[42px]">
            <Input
              type="number"
              min="1"
              max="31"
              value={newBillingDay}
              onChange={(e) => setNewBillingDay(parseInt(e.target.value) || 1)}
              aria-label="יום חיוב בחודש"
              title="יום חיוב בחודש (1-31)"
              className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[8px] border-none outline-none px-[8px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <div className="flex-1 border border-[#4C526B] rounded-[8px] h-[42px]">
            <Input
              type="text"
              value={newCardName}
              onChange={(e) => setNewCardName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCreditCard()}
              placeholder="שם חברת האשראי (ויזה, מאסטרקארד...)"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[8px] border-none outline-none px-[12px] placeholder:text-white/30"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-[8px]">
          {creditCards.map((card, index) => (
            <div key={card.id || index} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveCreditCard(index)}
                aria-label={`הסר ${card.cardName}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{card.cardName}</span>
              <span className="text-[12px] text-white/60 bg-[#4956D4]/30 px-[6px] py-[2px] rounded">יום {card.billingDay}</span>
            </div>
          ))}
          {creditCards.length === 0 && (
            <span className="text-[12px] text-white/30">אין כרטיסי אשראי</span>
          )}
        </div>
      </div>

      {/* Section 5: Managed Products */}
      <div className="bg-[#4956D4]/20 rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מוצרים מנוהלים</h3>
        <p className="text-[12px] text-white/50 text-right mb-[10px]">מוצרים עם מעקב מלאי ועלויות</p>

        <div className="flex flex-col gap-[10px] mb-[10px]">
          <div className="flex gap-[10px]">
            <div className="flex-1 border border-[#4C526B] rounded-[8px] h-[42px]">
              <Input
                type="text"
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                placeholder="שם המוצר"
                className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[8px] border-none outline-none px-[12px] placeholder:text-white/30"
              />
            </div>
          </div>
          <div className="flex gap-[10px]">
            <Button
              variant="default"
              size="sm"
              type="button"
              onClick={handleAddManagedProduct}
              disabled={!newProductName.trim() || !newProductUnit.trim()}
              className="bg-[#4956D4] text-white text-[14px] font-semibold px-[15px] py-[10px] rounded-[8px] disabled:opacity-50"
            >
              הוסף
            </Button>
            <div className="w-[100px] border border-[#4C526B] rounded-[8px] h-[42px]">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={newProductCost}
                onChange={(e) => setNewProductCost(parseFloat(e.target.value) || 0)}
                aria-label="מחיר ליחידה"
                title="מחיר ליחידה"
                placeholder="מחיר"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[8px] border-none outline-none px-[8px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-white/30"
              />
            </div>
            <div className="w-[120px] border border-[#4C526B] rounded-[8px] h-[42px]">
              <Input
                type="text"
                value={newProductUnit}
                onChange={(e) => setNewProductUnit(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddManagedProduct()}
                placeholder="יחידת מידה (ק״ג, ליטר...)"
                className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[8px] border-none outline-none px-[12px] placeholder:text-white/30"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-[8px]">
          {managedProducts.map((product, index) => (
            <div key={product.id || index} className="flex items-center justify-between bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[8px]">
              <div className="flex items-center gap-[8px]">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => handleRemoveManagedProduct(index)}
                  aria-label={`הסר ${product.name}`}
                  className="text-[#F64E60] hover:text-[#ff6b7a]"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </Button>
                <span className="text-[14px] text-white font-medium">{product.name}</span>
              </div>
              <div className="flex items-center gap-[8px]">
                <Input
                  type="text"
                  value={product.unit}
                  onChange={(e) => {
                    const updated = [...managedProducts];
                    updated[index] = { ...updated[index], unit: e.target.value };
                    setManagedProducts(updated);
                  }}
                  className="w-[70px] text-[12px] text-white/80 bg-[#4956D4]/30 px-[6px] py-[2px] rounded border border-transparent focus:border-[#4956D4] outline-none text-center"
                />
                <div className="flex items-center bg-[#4956D4]/40 rounded overflow-hidden">
                  <span className="text-[12px] text-white/60 px-[4px]">₪</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={product.unitCost}
                    onChange={(e) => {
                      const updated = [...managedProducts];
                      updated[index] = { ...updated[index], unitCost: parseFloat(e.target.value) || 0 };
                      setManagedProducts(updated);
                    }}
                    className="w-[60px] text-[12px] text-white/80 bg-transparent px-[4px] py-[2px] border-none outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </div>
          ))}
          {managedProducts.length === 0 && (
            <span className="text-[12px] text-white/30">אין מוצרים מנוהלים</span>
          )}
        </div>
      </div>

      {incomeSources.length === 0 && (
        <div className="text-center py-[15px] bg-[#F64E60]/10 rounded-[10px]">
          <p className="text-[14px] text-[#F64E60]">יש להוסיף לפחות מקור הכנסה אחד</p>
        </div>
      )}
    </div>
  );

  const renderStep4 = () => (
    <div className="flex flex-col gap-[15px]">
      <div className="text-center mb-[10px]">
        <p className="text-[14px] text-white/70">
          ניהול בעלי העסק והעובדים. חייב להיות לפחות בעל עסק אחד.
        </p>
      </div>

      {/* Existing Team Members List */}
      {teamMembers.filter(m => m.isExisting).length > 0 && (
        <div className="flex flex-col gap-[10px] mb-[15px]">
          <h3 className="text-[15px] font-bold text-white text-right">משתמשים קיימים ({teamMembers.filter(m => m.isExisting).length})</h3>
          {teamMembers.filter(m => m.isExisting).map((member, idx) => {
            const index = teamMembers.findIndex(m => m === member);
            return (
              <div
                key={member.id || idx}
                className="flex flex-row-reverse items-center justify-between bg-[#0F1535] rounded-[10px] p-[12px]"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => handleRemoveTeamMember(index)}
                  className="text-[#F64E60] text-[20px] font-bold hover:opacity-80"
                >
                  ×
                </Button>
                <div className="flex flex-row-reverse items-center gap-[10px]">
                  <div className="text-right">
                    <p className="text-[14px] text-white">{member.name || member.email}</p>
                    {member.name && <p className="text-[12px] text-white/50">{member.email}</p>}
                  </div>
                  <span
                    className={`px-[10px] py-[4px] rounded-[6px] text-[12px] font-medium ${
                      member.role === "owner"
                        ? "bg-[#9B59B6]/20 text-[#9B59B6]"
                        : "bg-[#3498DB]/20 text-[#3498DB]"
                    }`}
                  >
                    {member.role === "owner" ? "בעל עסק" : "עובד"}
                  </span>
                  <div className="w-[40px] h-[40px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {member.avatar_url ? (
                      <Image
                        src={member.avatar_url}
                        alt={member.name || member.email}
                        className="w-full h-full object-cover"
                        width={40}
                        height={40}
                        unoptimized
                      />
                    ) : (
                      <span className="text-white text-[16px] font-bold">
                        {(member.name || member.email || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Team Member Form */}
      <form className="bg-[#0F1535] rounded-[15px] p-[8px]" onSubmit={(e) => e.preventDefault()}>
        <h3 className="text-[15px] font-bold text-white text-right mb-[10px]">הוספת משתמש חדש</h3>

        {/* Email */}
        <div className="flex flex-col gap-[5px] mb-[10px]">
          <label className="text-[14px] font-medium text-white text-right">
            <span className="text-[#F64E60]">*</span> אימייל
          </label>
          <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
            <Input
              type="email"
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
            />
          </div>
        </div>

        {/* Password */}
        <div className="flex flex-col gap-[5px] mb-[10px]">
          <label className="text-[14px] font-medium text-white text-right">
            <span className="text-[#F64E60]">*</span> סיסמה
          </label>
          <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
            <Input
              type="password"
              autoComplete="new-password"
              value={newMemberPassword}
              onChange={(e) => setNewMemberPassword(e.target.value)}
              placeholder="לפחות 6 תווים"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
            />
          </div>
        </div>

        {/* Name */}
        <div className="flex flex-col gap-[5px] mb-[10px]">
          <label className="text-[14px] font-medium text-white text-right">שם מלא</label>
          <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
            <Input
              type="text"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="שם מלא"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
            />
          </div>
        </div>

        {/* Phone */}
        <div className="flex flex-col gap-[5px] mb-[10px]">
          <label className="text-[14px] font-medium text-white text-right">מספר טלפון</label>
          <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
            <Input
              type="tel"
              value={newMemberPhone}
              onChange={(e) => setNewMemberPhone(e.target.value)}
              placeholder="050-0000000"
              className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
            />
          </div>
        </div>

        {/* Avatar Upload */}
        <div className="flex flex-col gap-[5px] mb-[10px]">
          <label className="text-[14px] font-medium text-white text-right">תמונת פרופיל</label>
          <div className="flex items-center gap-[10px]">
            {/* Preview */}
            <div className="w-[45px] h-[45px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
              {newMemberAvatarUrl ? (
                <Image
                  src={newMemberAvatarUrl}
                  alt="תצוגה מקדימה"
                  className="w-full h-full object-cover"
                  width={45}
                  height={45}
                  unoptimized
                />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white/50">
                  <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                </svg>
              )}
            </div>
            {/* Upload Button */}
            <input
              ref={memberAvatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleMemberAvatarUpload}
              aria-label="העלה תמונת פרופיל"
              className="hidden"
            />
            <Button
              variant="outline"
              type="button"
              onClick={() => memberAvatarInputRef.current?.click()}
              disabled={isUploadingMemberAvatar}
              className="flex-1 border border-[#4C526B] rounded-[10px] h-[45px] flex items-center justify-center gap-[8px] text-white/70 hover:text-white hover:border-white/50 transition-colors disabled:opacity-50"
            >
              {isUploadingMemberAvatar ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  מעלה...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  העלה תמונה
                </>
              )}
            </Button>
            {newMemberAvatarUrl && (
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => setNewMemberAvatarUrl("")}
                className="w-[45px] h-[45px] border border-[#F64E60]/50 rounded-[10px] flex items-center justify-center text-[#F64E60] hover:bg-[#F64E60]/20 transition-colors"
                title="הסר תמונה"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
            )}
          </div>
        </div>

        {/* Role Selection */}
        <div className="flex flex-col gap-[5px] mb-[15px]">
          <label className="text-[14px] font-medium text-white text-right">תפקיד</label>
          <div className="flex gap-[10px]">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setNewMemberRole("owner")}
              className={`flex-1 h-[40px] rounded-[10px] text-[14px] font-medium transition-all ${
                newMemberRole === "owner"
                  ? "bg-[#9B59B6] text-white"
                  : "bg-[#1A1F37] text-white/60 border border-[#4C526B]"
              }`}
            >
              בעל עסק
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setNewMemberRole("employee")}
              className={`flex-1 h-[40px] rounded-[10px] text-[14px] font-medium transition-all ${
                newMemberRole === "employee"
                  ? "bg-[#3498DB] text-white"
                  : "bg-[#1A1F37] text-white/60 border border-[#4C526B]"
              }`}
            >
              עובד
            </Button>
          </div>
        </div>

        {/* Add Button */}
        <Button
          variant="default"
          type="button"
          onClick={handleAddTeamMember}
          disabled={!newMemberEmail.trim() || !newMemberPassword.trim() || newMemberPassword.length < 6}
          className="w-full h-[45px] bg-gradient-to-r from-[#0075FF] to-[#00D4FF] text-white text-[14px] font-bold rounded-[10px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + הוסף משתמש
        </Button>
      </form>

      {/* New Team Members List */}
      {teamMembers.filter(m => !m.isExisting).length > 0 && (
        <div className="flex flex-col gap-[10px]">
          <h3 className="text-[15px] font-bold text-white text-right">משתמשים חדשים ({teamMembers.filter(m => !m.isExisting).length})</h3>
          {teamMembers.filter(m => !m.isExisting).map((member, idx) => {
            const index = teamMembers.findIndex(m => m === member);
            return (
              <div
                key={idx}
                className="flex flex-row-reverse items-center justify-between bg-[#0F1535] rounded-[10px] p-[12px] border border-[#3CD856]/30"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => handleRemoveTeamMember(index)}
                  className="text-[#F64E60] text-[20px] font-bold hover:opacity-80"
                >
                  ×
                </Button>
                <div className="flex flex-row-reverse items-center gap-[10px]">
                  <div className="text-right">
                    <p className="text-[14px] text-white">{member.name || member.email}</p>
                    {member.name && <p className="text-[12px] text-white/50">{member.email}</p>}
                  </div>
                  <span
                    className={`px-[10px] py-[4px] rounded-[6px] text-[12px] font-medium ${
                      member.role === "owner"
                        ? "bg-[#9B59B6]/20 text-[#9B59B6]"
                        : "bg-[#3498DB]/20 text-[#3498DB]"
                    }`}
                  >
                    {member.role === "owner" ? "בעל עסק" : "עובד"}
                  </span>
                  <div className="w-[40px] h-[40px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {member.avatar_url ? (
                      <Image
                        src={member.avatar_url}
                        alt={member.name || member.email}
                        className="w-full h-full object-cover"
                        width={40}
                        height={40}
                        unoptimized
                      />
                    ) : (
                      <span className="text-white text-[16px] font-bold">
                        {(member.name || member.email || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Warning if no owner */}
      {!hasOwner && (
        <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[10px] p-[12px]">
          <p className="text-[13px] text-[#F64E60] text-right">
            חובה להיות לפחות בעל עסק אחד
          </p>
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-52px)]">
        <div className="animate-spin w-8 h-8 border-4 border-[#4A56D4]/30 border-t-[#4A56D4] rounded-full"></div>
      </div>
    );
  }

  // Only admins can access this page
  if (!isAdmin) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] text-white px-[20px]">
        <div className="w-[80px] h-[80px] rounded-full bg-[#F64E60]/20 flex items-center justify-center mb-[20px]">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#F64E60]">
            <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <h2 className="text-[20px] font-bold mb-[10px]">אין לך הרשאת ניהול</h2>
        <p className="text-[14px] text-white/60 text-center">רק מנהלי מערכת יכולים לערוך עסקים</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] text-white pb-[100px]">
      {/* Header */}
      <div className="flex flex-col items-center gap-[10px] mb-[20px]">
        <h1 className="text-[24px] font-bold text-white">עריכת עסק</h1>
        <p className="text-[14px] text-white/60">{businessName}</p>

        {/* Status Toggle */}
        <div className="flex items-center gap-[10px] mt-[5px]">
          <Badge className={`text-[13px] px-[10px] py-[3px] rounded-full font-bold ${
            businessStatus === "active"
              ? "bg-[#3CD856]/20 text-[#3CD856]"
              : "bg-[#F64E60]/20 text-[#F64E60]"
          }`}>
            {businessStatus === "active" ? "פעיל" : "לא פעיל"}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setShowStatusConfirm(true)}
            disabled={isTogglingStatus}
            className={`text-[13px] px-[12px] py-[5px] rounded-[8px] font-semibold transition-colors ${
              businessStatus === "active"
                ? "bg-[#F64E60]/20 text-[#F64E60] hover:bg-[#F64E60]/30"
                : "bg-[#3CD856]/20 text-[#3CD856] hover:bg-[#3CD856]/30"
            } disabled:opacity-50`}
          >
            {businessStatus === "active" ? "הפוך ללא פעיל" : "הפעל מחדש"}
          </Button>
        </div>
      </div>

      {/* Status Confirmation Dialog */}
      {showStatusConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-[20px]" onClick={() => setShowStatusConfirm(false)}>
          <div className="bg-[#1B2559] rounded-[15px] p-[25px] max-w-[400px] w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center">
              <div className={`w-[60px] h-[60px] rounded-full flex items-center justify-center mb-[15px] ${
                businessStatus === "active" ? "bg-[#F64E60]/20" : "bg-[#3CD856]/20"
              }`}>
                {businessStatus === "active" ? (
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-[#F64E60]">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
                    <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <h3 className="text-[18px] font-bold text-white mb-[8px]">
                {businessStatus === "active" ? "להפוך את העסק ללא פעיל?" : "להפעיל את העסק מחדש?"}
              </h3>
              <p className="text-[14px] text-white/60 mb-[20px]">
                {businessStatus === "active"
                  ? "המשתמשים של העסק ייחסמו, לא ייפתחו יעדים חדשים ולא ניתן יהיה להוסיף הוצאות ותשלומים."
                  : "העסק יחזור להיות פעיל ומשתמשיו יוכלו להתחבר מחדש."}
              </p>
              <div className="flex gap-[10px] w-full">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setShowStatusConfirm(false)}
                  className="flex-1 bg-transparent border border-[#4C526B] text-white text-[14px] font-semibold py-[10px] rounded-[10px] hover:bg-white/10"
                >
                  ביטול
                </Button>
                <Button
                  variant="default"
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={isTogglingStatus}
                  className={`flex-1 text-white text-[14px] font-semibold py-[10px] rounded-[10px] transition-colors disabled:opacity-50 ${
                    businessStatus === "active"
                      ? "bg-[#F64E60] hover:bg-[#d43b4f]"
                      : "bg-[#3CD856] hover:bg-[#2fb847]"
                  }`}
                >
                  {isTogglingStatus ? "מעדכן..." : businessStatus === "active" ? "הפוך ללא פעיל" : "הפעל מחדש"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Steps Progress */}
      <div className="flex items-center justify-center mb-[25px]">
        {[1, 2, 3, 4].map((step, index) => (
          <div key={step} className="flex items-center">
            {index > 0 && (
              <div className={`w-[30px] h-[3px] transition-all duration-300 ${
                step <= currentStep
                  ? "bg-gradient-to-r from-[#4956D4] to-[#6B7AE8]"
                  : "bg-[#29318A]/50"
              }`} />
            )}
            <Button
              variant="ghost"
              type="button"
              onClick={() => setCurrentStep(step)}
              suppressHydrationWarning
              className={`relative w-[36px] h-[36px] rounded-full flex items-center justify-center text-[14px] font-bold transition-all duration-300 z-10 ${
                step === currentStep
                  ? "bg-gradient-to-br from-[#4956D4] to-[#6B7AE8] text-white shadow-[0_0_15px_rgba(73,86,212,0.4)]"
                  : step < currentStep
                  ? "bg-gradient-to-br from-[#00C853] to-[#69F0AE] text-white cursor-pointer hover:scale-110"
                  : "bg-[#29318A]/50 text-white/50 cursor-pointer hover:bg-[#29318A]"
              }`}
            >
              {step < currentStep ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                step
              )}
            </Button>
          </div>
        ))}
      </div>

      {/* Step Title */}
      <div className="text-center mb-[20px]">
        <h2 className="text-[20px] font-bold text-white">
          {currentStep === 1 && "פרטי העסק"}
          {currentStep === 2 && "לוח זמנים"}
          {currentStep === 3 && "הגדרות והכנסות"}
          {currentStep === 4 && "צוות העסק"}
        </h2>
        <p className="text-[13px] text-white/50 mt-[4px]">
          {currentStep === 1 && "ערוך את פרטי העסק הבסיסיים"}
          {currentStep === 2 && "ערוך את ימי ושעות הפעילות"}
          {currentStep === 3 && "ערוך מקורות הכנסה, כרטיסים ומוצרים"}
          {currentStep === 4 && "ערוך בעלים ועובדים של העסק"}
        </p>
      </div>

      {/* Form Container */}
      <div className="flex-1 bg-[#0F1535] rounded-[20px] p-[10px]">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
      </div>

      {/* Navigation Buttons */}
      <div className="fixed bottom-0 left-0 right-0 lg:right-[220px] bg-[#0F1535] border-t border-white/10 p-[15px] flex gap-[10px]">
        {currentStep > 1 && (
          <Button
            variant="outline"
            type="button"
            onClick={() => setCurrentStep(currentStep - 1)}
            className="flex-1 bg-transparent border border-[#4C526B] text-white text-[16px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
          >
            חזרה
          </Button>
        )}

        {currentStep < 4 ? (
          <Button
            variant="default"
            type="button"
            onClick={() => setCurrentStep(currentStep + 1)}
            disabled={
              (currentStep === 1 && !canProceedStep1) ||
              (currentStep === 2 && !canProceedStep2) ||
              (currentStep === 3 && !canProceedStep3)
            }
            className="flex-1 bg-[#4956D4] text-white text-[16px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#5A67E0] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            המשך
          </Button>
        ) : (
          <Button
            variant="default"
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="flex-1 bg-[#3CD856] text-white text-[16px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#2fb847] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                מעדכן עסק...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                שמור שינויים
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
