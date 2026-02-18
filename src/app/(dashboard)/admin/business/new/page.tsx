"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { convertPdfToImage } from "@/lib/pdfToImage";
import { useFormDraft } from "@/hooks/useFormDraft";
import { generateUUID } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export default function NewBusinessPage() {
  const router = useRouter();
  const { showToast } = useToast();

  // Draft persistence
  const { saveDraft, restoreDraft, clearDraft } = useFormDraft("newBusiness:draft");
  const draftRestored = useRef(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user is admin on mount
  useEffect(() => {
    const checkAdmin = async () => {
      const supabase = createClient();
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

      setIsAdmin(profile?.is_admin === true);
      setIsLoading(false);
    };

    checkAdmin();
  }, []);

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
  const [managerSalary, setManagerSalary] = useState<number>(0);
  const [markupPercentage, setMarkupPercentage] = useState<number>(18); // אחוז העמסה (נשמר כ-1 + value/100)
  const [vatPercentage, setVatPercentage] = useState<number>(18); // אחוז מע"מ (נשמר כ-1 + value/100)

  // Step 2: Business Schedule
  const [schedule, setSchedule] = useState<Record<number, string>>({
    0: "1", // Sunday - full day
    1: "1", // Monday
    2: "1", // Tuesday
    3: "1", // Wednesday
    4: "1", // Thursday
    5: "0.5", // Friday - half day
    6: "0", // Saturday - closed
  });

  // Step 3: Income Sources, Receipt Types, Custom Parameters
  const [incomeSources, setIncomeSources] = useState<string[]>([]);
  const [newIncomeSource, setNewIncomeSource] = useState("");

  const [receiptTypes, setReceiptTypes] = useState<string[]>([]);
  const [newReceiptType, setNewReceiptType] = useState("");

  const [customParameters, setCustomParameters] = useState<string[]>([]);
  const [newCustomParameter, setNewCustomParameter] = useState("");

  // Credit Cards
  interface CreditCard {
    cardName: string;
    billingDay: number;
  }
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [newCardName, setNewCardName] = useState("");
  const [newBillingDay, setNewBillingDay] = useState<number>(10);

  // Managed Products
  interface ManagedProduct {
    name: string;
    unit: string;
    unitCost: number;
  }
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);
  const [newProductName, setNewProductName] = useState("");
  const [newProductUnit, setNewProductUnit] = useState("");
  const [newProductCost, setNewProductCost] = useState<number>(0);

  // Step 4: Team Members (Owner + Employees)
  interface TeamMember {
    email: string;
    name: string;
    password: string;
    phone: string;
    avatar_url: string;
    role: "owner" | "employee";
    isExisting?: boolean;
    existingUserId?: string;
  }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberAvatarUrl, setNewMemberAvatarUrl] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"owner" | "employee">("owner");
  const [isUploadingMemberAvatar, setIsUploadingMemberAvatar] = useState(false);
  const memberAvatarInputRef = useRef<HTMLInputElement>(null);

  // Step 5: Suppliers CSV Import
  interface CsvSupplier {
    name: string;
    expense_type: string;
    contact_name: string;
    phone: string;
    email: string;
    tax_id: string;
    address: string;
    payment_terms_days: number;
    notes: string;
  }
  const [csvSuppliers, setCsvSuppliers] = useState<CsvSupplier[]>([]);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsingDone, setCsvParsingDone] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Save draft on form changes
  const saveDraftData = useCallback(() => {
    saveDraft({
      currentStep,
      businessName, businessType, customBusinessType, taxId, address, city, phone, email,
      managerSalary, markupPercentage, vatPercentage,
      schedule,
      incomeSources, receiptTypes, customParameters, creditCards, managedProducts,
      teamMembers: teamMembers.map(m => ({ ...m })),
    });
  }, [saveDraft, currentStep,
    businessName, businessType, customBusinessType, taxId, address, city, phone, email,
    managerSalary, markupPercentage, vatPercentage,
    schedule, incomeSources, receiptTypes, customParameters, creditCards, managedProducts,
    teamMembers]);

  useEffect(() => {
    if (draftRestored.current) {
      saveDraftData();
    }
  }, [saveDraftData]);

  // Restore draft on mount
  useEffect(() => {
    draftRestored.current = false;
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
      if (draft.incomeSources) setIncomeSources(draft.incomeSources as string[]);
      if (draft.receiptTypes) setReceiptTypes(draft.receiptTypes as string[]);
      if (draft.customParameters) setCustomParameters(draft.customParameters as string[]);
      if (draft.creditCards) setCreditCards(draft.creditCards as CreditCard[]);
      if (draft.managedProducts) setManagedProducts(draft.managedProducts as ManagedProduct[]);
      if (draft.teamMembers) setTeamMembers(draft.teamMembers as TeamMember[]);
    }
    draftRestored.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvFileName(file.name);
    setCsvParsingDone(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");

        if (lines.length < 2) {
          setCsvError("הקובץ חייב להכיל לפחות שורת כותרות ושורת נתונים אחת");
          return;
        }

        // Parse header - support both comma and tab delimiters
        const delimiter = lines[0].includes("\t") ? "\t" : ",";
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, "").replace(/^\uFEFF/, ""));

        // Map Hebrew/English header names to field names
        const headerMap: Record<string, keyof CsvSupplier> = {
          "name": "name",
          "שם": "name",
          "שם ספק": "name",
          "supplier_name": "name",
          "supplier name": "name",
          "expense_type": "expense_type",
          "סוג הוצאה": "expense_type",
          "סוג": "expense_type",
          "type": "expense_type",
          "contact_name": "contact_name",
          "איש קשר": "contact_name",
          "contact": "contact_name",
          "phone": "phone",
          "טלפון": "phone",
          "email": "email",
          "אימייל": "email",
          "מייל": "email",
          "tax_id": "tax_id",
          "ח.פ": "tax_id",
          "עוסק": "tax_id",
          "מספר עוסק": "tax_id",
          "address": "address",
          "כתובת": "address",
          "payment_terms_days": "payment_terms_days",
          "ימי תשלום": "payment_terms_days",
          "תנאי תשלום": "payment_terms_days",
          "payment_terms": "payment_terms_days",
          "notes": "notes",
          "הערות": "notes",
        };

        const columnMapping: (keyof CsvSupplier | null)[] = headers.map(h => {
          const lower = h.toLowerCase();
          return headerMap[lower] || headerMap[h] || null;
        });

        // Check that "name" column exists
        if (!columnMapping.includes("name")) {
          setCsvError(`לא נמצאה עמודת "שם ספק" בקובץ. עמודות שנמצאו: ${headers.join(", ")}`);
          return;
        }

        const suppliers: CsvSupplier[] = [];
        const errors: string[] = [];

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ""));

          const supplier: CsvSupplier = {
            name: "",
            expense_type: "current_expenses",
            contact_name: "",
            phone: "",
            email: "",
            tax_id: "",
            address: "",
            payment_terms_days: 30,
            notes: "",
          };

          columnMapping.forEach((field, idx) => {
            if (field && values[idx] !== undefined) {
              const val = values[idx];
              if (field === "payment_terms_days") {
                supplier[field] = parseInt(val) || 30;
              } else if (field === "expense_type") {
                // Normalize expense type
                const lower = val.toLowerCase();
                if (lower === "goods_purchases" || lower === "רכש סחורה" || lower === "סחורה") {
                  supplier.expense_type = "goods_purchases";
                } else if (lower === "employee_costs" || lower === "עלות עובדים") {
                  supplier.expense_type = "employee_costs";
                } else {
                  supplier.expense_type = "current_expenses";
                }
              } else {
                supplier[field] = val;
              }
            }
          });

          if (!supplier.name.trim()) {
            errors.push(`שורה ${i + 1}: חסר שם ספק`);
            continue;
          }

          // Check for duplicate names
          if (suppliers.some(s => s.name === supplier.name)) {
            errors.push(`שורה ${i + 1}: ספק "${supplier.name}" כבר קיים`);
            continue;
          }

          suppliers.push(supplier);
        }

        if (errors.length > 0 && suppliers.length === 0) {
          setCsvError(errors.join("\n"));
          return;
        }

        if (errors.length > 0) {
          setCsvError(`נטענו ${suppliers.length} ספקים. אזהרות:\n${errors.join("\n")}`);
        }

        setCsvSuppliers(suppliers);
        setCsvParsingDone(true);
      } catch {
        setCsvError("שגיאה בקריאת הקובץ. ודא שהקובץ בפורמט CSV תקין");
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleRemoveCsvSupplier = (index: number) => {
    setCsvSuppliers(csvSuppliers.filter((_, i) => i !== index));
  };

  const handleClearCsv = () => {
    setCsvSuppliers([]);
    setCsvFileName(null);
    setCsvError(null);
    setCsvParsingDone(false);
    if (csvInputRef.current) csvInputRef.current.value = "";
  };

  // Existing user search
  const [addMode, setAddMode] = useState<"new" | "existing">("new");
  interface ExistingUser {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  }
  const [existingUserSearch, setExistingUserSearch] = useState("");
  const [existingUserResults, setExistingUserResults] = useState<ExistingUser[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [selectedExistingUser, setSelectedExistingUser] = useState<ExistingUser | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (newIncomeSource.trim() && !incomeSources.includes(newIncomeSource.trim())) {
      setIncomeSources([...incomeSources, newIncomeSource.trim()]);
      setNewIncomeSource("");
    }
  };

  const handleRemoveIncomeSource = (source: string) => {
    setIncomeSources(incomeSources.filter((s) => s !== source));
  };

  const handleAddReceiptType = () => {
    if (newReceiptType.trim() && !receiptTypes.includes(newReceiptType.trim())) {
      setReceiptTypes([...receiptTypes, newReceiptType.trim()]);
      setNewReceiptType("");
    }
  };

  const handleRemoveReceiptType = (type: string) => {
    setReceiptTypes(receiptTypes.filter((t) => t !== type));
  };

  const handleAddCustomParameter = () => {
    if (newCustomParameter.trim() && !customParameters.includes(newCustomParameter.trim())) {
      setCustomParameters([...customParameters, newCustomParameter.trim()]);
      setNewCustomParameter("");
    }
  };

  const handleRemoveCustomParameter = (param: string) => {
    setCustomParameters(customParameters.filter((p) => p !== param));
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

    // Validate file type
    if (!file.type.startsWith("image/")) {
      showToast("יש להעלות קובץ תמונה בלבד", "warning");
      return;
    }

    // Validate file size (max 2MB)
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

  // Search existing users
  const handleSearchExistingUsers = async (query: string) => {
    setExistingUserSearch(query);
    setSelectedExistingUser(null);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query.trim() || query.trim().length < 2) {
      setExistingUserResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearchingUsers(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("profiles")
          .select("id, email, full_name, phone, avatar_url")
          .or(`email.ilike.%${query.trim()}%,full_name.ilike.%${query.trim()}%`)
          .limit(10);

        if (error) {
          console.error("Error searching users:", error);
          return;
        }

        // Filter out users already added to team
        const addedEmails = teamMembers.map(m => m.email.toLowerCase());
        const filtered = (data || []).filter(
          u => !addedEmails.includes(u.email.toLowerCase())
        );

        setExistingUserResults(filtered);
      } catch (err) {
        console.error("Error searching users:", err);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 300);
  };

  // Add existing user to team
  const handleAddExistingUser = () => {
    if (!selectedExistingUser) return;
    if (teamMembers.some(m => m.email.toLowerCase() === selectedExistingUser.email.toLowerCase())) {
      showToast("משתמש זה כבר נוסף לצוות", "warning");
      return;
    }

    setTeamMembers([...teamMembers, {
      email: selectedExistingUser.email,
      name: selectedExistingUser.full_name || "",
      password: "",
      phone: selectedExistingUser.phone || "",
      avatar_url: selectedExistingUser.avatar_url || "",
      role: newMemberRole,
      isExisting: true,
      existingUserId: selectedExistingUser.id,
    }]);
    setSelectedExistingUser(null);
    setExistingUserSearch("");
    setExistingUserResults([]);
    setNewMemberRole("employee");
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
      role: newMemberRole
    }]);
    setNewMemberEmail("");
    setNewMemberName("");
    setNewMemberPassword("");
    setNewMemberPhone("");
    setNewMemberAvatarUrl("");
    setNewMemberRole("employee");
  };

  const handleRemoveTeamMember = (index: number) => {
    setTeamMembers(teamMembers.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const supabase = createClient();

    try {
      // 1. Upload logo if provided
      let logoUrl: string | null = null;
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
          showToast(`שגיאה בהעלאת הלוגו: ${result.error}`, "error");
          // Continue without logo if upload fails
        } else {
          logoUrl = result.publicUrl || null;
        }
      }

      // 2. Create business record
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .insert({
          name: businessName,
          business_type: businessType === "other" ? customBusinessType.trim() : businessType,
          tax_id: taxId || null,
          address: address || null,
          city: city || null,
          phone: phone || null,
          email: email || null,
          logo_url: logoUrl,
          status: "active",
          manager_monthly_salary: managerSalary,
          markup_percentage: 1 + markupPercentage / 100, // המרה מאחוז (1) ל-1.01
          vat_percentage: vatPercentage / 100, // המרה מאחוז (18) ל-0.18
        })
        .select()
        .single();

      if (businessError) {
        throw new Error(`שגיאה ביצירת העסק: ${businessError.message}`);
      }

      // 3. Update business schedule records (trigger already created defaults)
      // Update each day's factor if different from default
      for (const [dayOfWeek, dayFactor] of Object.entries(schedule)) {
        const { error: scheduleError } = await supabase
          .from("business_schedule")
          .update({ day_factor: parseFloat(dayFactor) })
          .eq("business_id", business.id)
          .eq("day_of_week", parseInt(dayOfWeek));

        if (scheduleError) {
          console.error(`Schedule update error for day ${dayOfWeek}:`, scheduleError);
        }
      }

      // 4. Create income sources
      if (incomeSources.length > 0) {
        const incomeSourceRecords = incomeSources.map((name, index) => ({
          business_id: business.id,
          name,
          display_order: index,
          is_active: true,
        }));

        const { error: incomeError } = await supabase
          .from("income_sources")
          .insert(incomeSourceRecords);

        if (incomeError) {
          console.error("Income sources creation error:", incomeError);
        }
      }

      // 5. Create receipt types
      if (receiptTypes.length > 0) {
        const receiptTypeRecords = receiptTypes.map((name, index) => ({
          business_id: business.id,
          name,
          display_order: index,
          is_active: true,
        }));

        const { error: receiptError } = await supabase
          .from("receipt_types")
          .insert(receiptTypeRecords);

        if (receiptError) {
          console.error("Receipt types creation error:", receiptError);
        }
      }

      // 6. Create custom parameters
      if (customParameters.length > 0) {
        const customParamRecords = customParameters.map((name, index) => ({
          business_id: business.id,
          name,
          display_order: index,
          is_active: true,
        }));

        const { error: paramError } = await supabase
          .from("custom_parameters")
          .insert(customParamRecords);

        if (paramError) {
          console.error("Custom parameters creation error:", paramError);
        }
      }

      // 7. Create credit cards
      if (creditCards.length > 0) {
        const creditCardRecords = creditCards.map((card) => ({
          business_id: business.id,
          card_name: card.cardName,
          billing_day: card.billingDay,
          is_active: true,
        }));

        const { error: cardError } = await supabase
          .from("business_credit_cards")
          .insert(creditCardRecords);

        if (cardError) {
          console.error("Credit cards creation error:", cardError);
        }
      }

      // 8. Create managed products
      if (managedProducts.length > 0) {
        const productRecords = managedProducts.map((product) => ({
          business_id: business.id,
          name: product.name,
          unit: product.unit,
          unit_cost: product.unitCost,
          is_active: true,
        }));

        const { error: productError } = await supabase
          .from("managed_products")
          .insert(productRecords);

        if (productError) {
          console.error("Managed products creation error:", productError);
        }
      }

      // 9. Create suppliers from CSV
      if (csvSuppliers.length > 0) {
        const supplierRecords = csvSuppliers.map((s) => ({
          business_id: business.id,
          name: s.name,
          expense_type: s.expense_type,
          contact_name: s.contact_name || null,
          phone: s.phone || null,
          email: s.email || null,
          tax_id: s.tax_id || null,
          address: s.address || null,
          payment_terms_days: s.payment_terms_days || 30,
          notes: s.notes || null,
          is_active: true,
        }));

        const { error: supplierError } = await supabase
          .from("suppliers")
          .insert(supplierRecords);

        if (supplierError) {
          console.error("Suppliers creation error:", supplierError);
        }
      }

      // 10. Create team members (owners and employees)
      // Note: The trigger already added the current admin as owner
      // Get current user to skip if they're in the list
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      for (const member of teamMembers) {
        // If this is an existing user selected from search, link directly
        if (member.isExisting && member.existingUserId) {
          // Skip if this is the current user (trigger already added them as owner)
          if (currentUser && member.existingUserId === currentUser.id) {
            console.log(`Skipping ${member.email} - already added by trigger`);
            continue;
          }

          const { error: memberError } = await supabase
            .from("business_members")
            .insert({
              business_id: business.id,
              user_id: member.existingUserId,
              role: member.role,
              joined_at: new Date().toISOString(),
            });

          if (memberError) {
            console.error(`Business member creation error for ${member.email}:`, memberError);
          }
          continue;
        }

        // Check if user exists in profiles
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("id, email")
          .eq("email", member.email)
          .maybeSingle();

        if (existingProfile) {
          // Skip if this is the current user (trigger already added them as owner)
          if (currentUser && existingProfile.id === currentUser.id) {
            console.log(`Skipping ${member.email} - already added by trigger`);
            continue;
          }

          // User exists - update profile with new info and create business_member
          await supabase
            .from("profiles")
            .update({
              full_name: member.name || null,
              phone: member.phone || null,
              avatar_url: member.avatar_url || null,
            })
            .eq("id", existingProfile.id);

          const { error: memberError } = await supabase
            .from("business_members")
            .insert({
              business_id: business.id,
              user_id: existingProfile.id,
              role: member.role,
              joined_at: new Date().toISOString(),
            });

          if (memberError) {
            console.error(`Business member creation error for ${member.email}:`, memberError);
          }
        } else {
          // User doesn't exist - create via API route (uses service role)
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
                businessId: business.id,
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

      // Success - redirect to dashboard
      clearDraft();
      showToast("העסק נוצר בהצלחה!", "success");
      router.push("/");
    } catch (error) {
      console.error("Error creating business:", error);
      showToast(error instanceof Error ? error.message : "שגיאה ביצירת העסק. נסה שוב.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep1 = businessName.trim() && businessType && (businessType !== "other" || customBusinessType.trim()) && taxId.trim();
  const canProceedStep2 = true; // Schedule has defaults
  const canProceedStep3 = incomeSources.length > 0;
  const canProceedStep4 = true; // Team members are optional
  const _hasOwner = teamMembers.some(m => m.role === "owner");
  const canSubmit = true;

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

      {/* Custom Business Type - shown when "other" is selected */}
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
          <div className="w-[12px] h-[12px] rounded-full bg-[#FFA412]"></div>
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
            {Object.values(schedule).reduce((sum, val) => sum + parseFloat(val), 0).toFixed(1)}
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
          {incomeSources.map((source) => (
            <div key={source} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveIncomeSource(source)}
                aria-label={`הסר ${source}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{source}</span>
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
          {receiptTypes.map((type) => (
            <div key={type} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveReceiptType(type)}
                aria-label={`הסר ${type}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{type}</span>
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
          {customParameters.map((param) => (
            <div key={param} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                onClick={() => handleRemoveCustomParameter(param)}
                aria-label={`הסר ${param}`}
                className="text-[#F64E60] hover:text-[#ff6b7a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <span className="text-[14px] text-white">{param}</span>
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
            <div key={index} className="flex items-center gap-[8px] bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[6px]">
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
            <div key={index} className="flex items-center justify-between bg-[#4956D4]/20 border border-[#4956D4]/50 rounded-[8px] px-[12px] py-[8px]">
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
                <span className="text-[12px] text-white/60 bg-[#4956D4]/30 px-[6px] py-[2px] rounded">{product.unit}</span>
                <span className="text-[12px] text-white/80 bg-[#4956D4]/40 px-[6px] py-[2px] rounded">₪{product.unitCost}</span>
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
          הוסף את בעלי העסק והעובדים. חייב להיות לפחות בעל עסק אחד.
        </p>
      </div>

      {/* Add Team Member Form */}
      <form className="bg-[#0F1535] rounded-[15px] p-[8px]" onSubmit={(e) => e.preventDefault()}>
        <h3 className="text-[15px] font-bold text-white text-right mb-[10px]">הוספת משתמש</h3>

        {/* Mode Toggle: New / Existing */}
        <div className="flex gap-[8px] mb-[12px]">
          <Button
            variant="ghost"
            type="button"
            onClick={() => { setAddMode("new"); setSelectedExistingUser(null); setExistingUserSearch(""); setExistingUserResults([]); }}
            className={`flex-1 h-[38px] rounded-[10px] text-[13px] font-medium transition-all ${
              addMode === "new"
                ? "bg-[#29318A] text-white"
                : "bg-[#1A1F37] text-white/60 border border-[#4C526B]"
            }`}
          >
            משתמש חדש
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => { setAddMode("existing"); setNewMemberEmail(""); setNewMemberPassword(""); setNewMemberName(""); setNewMemberPhone(""); setNewMemberAvatarUrl(""); }}
            className={`flex-1 h-[38px] rounded-[10px] text-[13px] font-medium transition-all ${
              addMode === "existing"
                ? "bg-gradient-to-r from-[#0075FF] to-[#00D4FF] text-white"
                : "bg-[#1A1F37] text-white/60 border border-[#4C526B]"
            }`}
          >
            משתמש קיים
          </Button>
        </div>

        {addMode === "existing" ? (
          <>
            {/* Search Existing Users */}
            <div className="flex flex-col gap-[5px] mb-[10px]">
              <label className="text-[14px] font-medium text-white text-right">
                <span className="text-[#F64E60]">*</span> חיפוש משתמש
              </label>
              <div className="border border-[#4C526B] rounded-[10px] h-[45px] flex items-center">
                <Input
                  type="text"
                  value={existingUserSearch}
                  onChange={(e) => handleSearchExistingUsers(e.target.value)}
                  placeholder="חפש לפי אימייל או שם..."
                  className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                />
                {isSearchingUsers && (
                  <svg className="animate-spin h-5 w-5 ml-[10px] text-white/50 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
              </div>
            </div>

            {/* Search Results */}
            {existingUserResults.length > 0 && !selectedExistingUser && (
              <div className="flex flex-col gap-[6px] mb-[10px] max-h-[200px] overflow-y-auto">
                {existingUserResults.map((user) => (
                  <Button
                    variant="ghost"
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedExistingUser(user);
                      setExistingUserSearch(user.email);
                      setExistingUserResults([]);
                    }}
                    className="flex items-center gap-[10px] bg-[#1A1F37] hover:bg-[#29318A]/50 border border-[#4C526B] rounded-[10px] p-[10px] transition-colors text-right w-full h-auto"
                  >
                    <div className="w-[36px] h-[36px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                      {user.avatar_url ? (
                        <Image src={user.avatar_url} alt={user.full_name || user.email} className="w-full h-full object-cover" width={36} height={36} unoptimized />
                      ) : (
                        <span className="text-white text-[14px] font-bold">
                          {(user.full_name || user.email || "?")[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {user.full_name && (
                        <p className="text-[13px] text-white truncate">{user.full_name}</p>
                      )}
                      <p className="text-[12px] text-white/60 truncate">{user.email}</p>
                    </div>
                  </Button>
                ))}
              </div>
            )}

            {/* No results */}
            {existingUserSearch.trim().length >= 2 && !isSearchingUsers && existingUserResults.length === 0 && !selectedExistingUser && (
              <div className="text-center py-[10px] mb-[10px]">
                <p className="text-[13px] text-white/40">לא נמצאו משתמשים</p>
              </div>
            )}

            {/* Selected User Preview */}
            {selectedExistingUser && (
              <div className="flex items-center gap-[10px] bg-[#29318A]/30 border border-[#4956D4]/50 rounded-[10px] p-[10px] mb-[10px]">
                <div className="w-[40px] h-[40px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {selectedExistingUser.avatar_url ? (
                    <Image src={selectedExistingUser.avatar_url} alt={selectedExistingUser.full_name || selectedExistingUser.email} className="w-full h-full object-cover" width={40} height={40} unoptimized />
                  ) : (
                    <span className="text-white text-[16px] font-bold">
                      {(selectedExistingUser.full_name || selectedExistingUser.email || "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0 text-right">
                  {selectedExistingUser.full_name && (
                    <p className="text-[14px] text-white">{selectedExistingUser.full_name}</p>
                  )}
                  <p className="text-[12px] text-white/60">{selectedExistingUser.email}</p>
                  {selectedExistingUser.phone && (
                    <p className="text-[11px] text-white/40">{selectedExistingUser.phone}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => {
                    setSelectedExistingUser(null);
                    setExistingUserSearch("");
                  }}
                  title="הסר בחירה"
                  className="w-[32px] h-[32px] border border-[#F64E60]/50 rounded-[8px] flex items-center justify-center text-[#F64E60] hover:bg-[#F64E60]/20 transition-colors flex-shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </Button>
              </div>
            )}

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

            {/* Add Existing User Button */}
            <Button
              variant="default"
              type="button"
              onClick={handleAddExistingUser}
              disabled={!selectedExistingUser}
              className="w-full h-[45px] bg-gradient-to-r from-[#0075FF] to-[#00D4FF] text-white text-[14px] font-bold rounded-[10px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + שייך משתמש קיים
            </Button>
          </>
        ) : (
          <>
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
              className="w-full h-[45px] bg-[#29318A] text-white text-[14px] font-bold rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + הוסף משתמש חדש
            </Button>
          </>
        )}
      </form>

      {/* Team Members List */}
      {teamMembers.length > 0 && (
        <div className="flex flex-col gap-[10px]">
          <h3 className="text-[15px] font-bold text-white text-right">משתמשים ({teamMembers.length})</h3>
          {teamMembers.map((member, index) => (
            <div
              key={index}
              className="flex items-center justify-between bg-[#0F1535] rounded-[10px] p-[12px]"
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
              <div className="flex items-center gap-[10px]">
                <div className="text-right">
                  <p className="text-[14px] text-white">{member.name || member.email}</p>
                  {member.name && <p className="text-[12px] text-white/50">{member.email}</p>}
                  {member.phone && <p className="text-[11px] text-white/40">{member.phone}</p>}
                </div>
                {member.isExisting && (
                  <span className="px-[8px] py-[3px] rounded-[6px] text-[11px] font-medium bg-[#00C853]/20 text-[#00C853]">
                    קיים
                  </span>
                )}
                <span
                  className={`px-[10px] py-[4px] rounded-[6px] text-[12px] font-medium ${
                    member.role === "owner"
                      ? "bg-[#9B59B6]/20 text-[#9B59B6]"
                      : "bg-[#3498DB]/20 text-[#3498DB]"
                  }`}
                >
                  {member.role === "owner" ? "בעל עסק" : "עובד"}
                </span>
                {/* Avatar */}
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
          ))}
        </div>
      )}

      {/* Info if no members added */}
      {teamMembers.length === 0 && (
        <div className="bg-[#0075FF]/10 border border-[#0075FF]/30 rounded-[10px] p-[12px]">
          <p className="text-[13px] text-white text-right">
            ניתן ליצור את העסק ללא משתמשים ולהוסיף אותם מאוחר יותר
          </p>
        </div>
      )}
      {/* Warning if members exist but no owner */}
      {teamMembers.length > 0 && !teamMembers.some(m => m.role === "owner") && (
        <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[12px]">
          <p className="text-[13px] text-[#FFA412] text-right">
            מומלץ להוסיף לפחות בעל עסק אחד
          </p>
        </div>
      )}

      {/* Summary Card */}
      <div className="bg-[#0F1535] rounded-[15px] p-[10px] mt-[10px]">
        <h3 className="text-[16px] font-bold text-white text-center mb-[15px]">סיכום העסק החדש</h3>
        <div className="flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">שם העסק:</span>
            <span className="text-[14px] text-white">{businessName || "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">ח.פ / מספר עוסק:</span>
            <span className="text-[14px] text-white">{taxId || "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">סוג:</span>
            <span className="text-[14px] text-white">
              {businessType === "other" ? customBusinessType || "-" : businessTypes.find((t) => t.id === businessType)?.label || "-"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">ימי פעילות:</span>
            <span className="text-[14px] text-white">
              {Object.values(schedule).reduce((sum, val) => sum + parseFloat(val), 0).toFixed(1)} ימים
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">מקורות הכנסה:</span>
            <span className="text-[14px] text-white">{incomeSources.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">כרטיסי אשראי:</span>
            <span className="text-[14px] text-white">{creditCards.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">מוצרים מנוהלים:</span>
            <span className="text-[14px] text-white">{managedProducts.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">ספקים (CSV):</span>
            <span className="text-[14px] text-white">{csvSuppliers.length}</span>
          </div>
          {managerSalary > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-white/60">שכר מנהל:</span>
              <span className="text-[14px] text-white">₪{managerSalary.toLocaleString()}</span>
            </div>
          )}
          {markupPercentage > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-white/60">אחוז העמסה:</span>
              <span className="text-[14px] text-white">{markupPercentage}%</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/60">אחוז מע&quot;מ:</span>
            <span className="text-[14px] text-white">{vatPercentage}%</span>
          </div>
          {/* Team Members Section */}
          {teamMembers.length > 0 && (
            <>
              <div className="border-t border-white/10 my-[10px]" />
              <div className="text-[13px] text-white/60 mb-[8px]">משתמשים ({teamMembers.length}):</div>

              {/* Owners */}
              {teamMembers.filter(m => m.role === "owner").length > 0 && (
                <div className="mb-[8px]">
                  <div className="text-[12px] text-[#9B59B6] mb-[4px]">בעלי עסק:</div>
                  <div className="flex flex-wrap gap-[6px]">
                    {teamMembers.filter(m => m.role === "owner").map((member, idx) => (
                      <span key={idx} className="text-[12px] bg-[#9B59B6]/20 text-white px-[8px] py-[4px] rounded-[6px]">
                        {member.name || member.email}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Employees */}
              {teamMembers.filter(m => m.role === "employee").length > 0 && (
                <div>
                  <div className="text-[12px] text-[#3498DB] mb-[4px]">עובדים:</div>
                  <div className="flex flex-wrap gap-[6px]">
                    {teamMembers.filter(m => m.role === "employee").map((member, idx) => (
                      <span key={idx} className="text-[12px] bg-[#3498DB]/20 text-white px-[8px] py-[4px] rounded-[6px]">
                        {member.name || member.email}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="flex flex-col gap-[15px]">
      <div className="text-center mb-[10px]">
        <p className="text-[14px] text-white/70">
          ניתן להעלות קובץ CSV עם רשימת הספקים של העסק. השלב הזה אופציונלי.
        </p>
      </div>

      {/* CSV Upload Area */}
      <div className="bg-[#4956D4]/20 rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">העלאת קובץ ספקים</h3>

        {!csvParsingDone ? (
          <>
            <label className="border border-[#4C526B] border-dashed rounded-[10px] min-h-[120px] px-[10px] py-[15px] flex flex-col items-center justify-center gap-[8px] cursor-pointer hover:border-[#4956D4] transition-colors">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#979797]">
                <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 18V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M9 15L12 12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[14px] text-[#979797]">לחץ להעלאת קובץ CSV</span>
              <span className="text-[12px] text-[#979797]/60">UTF-8 בלבד - תומך בעברית</span>
              {csvFileName && <span className="text-[12px] text-white/70">{csvFileName}</span>}
              <input
                ref={csvInputRef}
                type="file"
                onChange={handleCsvUpload}
                className="hidden"
                accept=".csv,text/csv"
              />
            </label>

            {csvError && (
              <div className="bg-[#F64E60]/10 border border-[#F64E60]/30 rounded-[10px] p-[10px] mt-[10px]">
                <p className="text-[13px] text-[#F64E60] text-right whitespace-pre-line">{csvError}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* File info & clear button */}
            <div className="flex items-center justify-between bg-[#0F1535] rounded-[10px] p-[10px] mb-[10px]">
              <Button
                variant="ghost"
                type="button"
                onClick={handleClearCsv}
                className="text-[#F64E60] text-[13px] hover:underline"
              >
                נקה הכל
              </Button>
              <div className="flex items-center gap-[8px]">
                <span className="text-[14px] text-white">{csvFileName}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {csvError && (
              <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[10px] mb-[10px]">
                <p className="text-[13px] text-[#FFA412] text-right whitespace-pre-line">{csvError}</p>
              </div>
            )}

            {/* Summary */}
            <div className="bg-[#0F1535] rounded-[10px] p-[10px] mb-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-[16px] font-bold text-[#3CD856]">{csvSuppliers.length}</span>
                <span className="text-[14px] text-white">ספקים נטענו בהצלחה</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* CSV Format Guide */}
      <div className="bg-[#0F1535] rounded-[15px] p-[8px]">
        <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">מבנה הקובץ הנדרש</h3>
        <p className="text-[12px] text-white/50 text-right mb-[10px]">
          שורה ראשונה: כותרות העמודות. שאר השורות: נתוני הספקים.
        </p>
        <div className="overflow-x-auto">
          <Table className="w-full text-[12px]">
            <TableHeader>
              <TableRow className="border-b border-white/10">
                <TableHead className="text-right text-white/60 py-[6px] px-[8px]">עמודה</TableHead>
                <TableHead className="text-right text-white/60 py-[6px] px-[8px]">חובה</TableHead>
                <TableHead className="text-right text-white/60 py-[6px] px-[8px]">דוגמה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-white/80">
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">שם ספק / name</TableCell>
                <TableCell className="py-[4px] px-[8px] text-[#F64E60]">כן</TableCell>
                <TableCell className="py-[4px] px-[8px]">חברת הניקיון</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">סוג הוצאה / expense_type</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">current_expenses / סחורה / עלות עובדים</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">איש קשר / contact_name</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">יוסי כהן</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">טלפון / phone</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">050-1234567</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">אימייל / email</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">supplier@email.com</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">ח.פ / tax_id</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">515678901</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">כתובת / address</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">רחוב הרצל 10</TableCell>
              </TableRow>
              <TableRow className="border-b border-white/5">
                <TableCell className="py-[4px] px-[8px]">ימי תשלום / payment_terms_days</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">30</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="py-[4px] px-[8px]">הערות / notes</TableCell>
                <TableCell className="py-[4px] px-[8px] text-white/40">לא</TableCell>
                <TableCell className="py-[4px] px-[8px]">ספק ראשי</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Suppliers Table */}
      {csvSuppliers.length > 0 && (
        <div className="bg-[#0F1535] rounded-[15px] p-[8px]">
          <h3 className="text-[16px] font-bold text-white text-right mb-[10px]">ספקים שנטענו ({csvSuppliers.length})</h3>
          <div className="flex flex-col gap-[8px]">
            {csvSuppliers.map((supplier, index) => (
              <div key={index} className="flex items-center justify-between bg-[#4956D4]/10 border border-[#4956D4]/30 rounded-[10px] p-[10px]">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => handleRemoveCsvSupplier(index)}
                  className="text-[#F64E60] hover:text-[#ff6b7a] flex-shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </Button>
                <div className="flex-1 text-right mr-[10px]">
                  <div className="flex items-center gap-[8px] justify-end flex-wrap">
                    <span className={`text-[11px] px-[6px] py-[2px] rounded ${
                      supplier.expense_type === "goods_purchases"
                        ? "bg-[#FFA412]/20 text-[#FFA412]"
                        : supplier.expense_type === "employee_costs"
                        ? "bg-[#00BCD4]/20 text-[#00BCD4]"
                        : "bg-[#3CD856]/20 text-[#3CD856]"
                    }`}>
                      {supplier.expense_type === "goods_purchases" ? "רכש סחורה" : supplier.expense_type === "employee_costs" ? "עלות עובדים" : "הוצאות שוטפות"}
                    </span>
                    <span className="text-[14px] text-white font-medium">{supplier.name}</span>
                  </div>
                  <div className="flex items-center gap-[12px] justify-end mt-[4px] flex-wrap">
                    {supplier.contact_name && (
                      <span className="text-[11px] text-white/40">{supplier.contact_name}</span>
                    )}
                    {supplier.phone && (
                      <span className="text-[11px] text-white/40">{supplier.phone}</span>
                    )}
                    {supplier.payment_terms_days !== 30 && (
                      <span className="text-[11px] text-white/40">שוטף + {supplier.payment_terms_days}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No suppliers info */}
      {csvSuppliers.length === 0 && csvParsingDone && (
        <div className="bg-[#FFA412]/10 border border-[#FFA412]/30 rounded-[10px] p-[12px]">
          <p className="text-[13px] text-[#FFA412] text-right">
            לא נטענו ספקים מהקובץ. בדוק את מבנה הקובץ.
          </p>
        </div>
      )}

      {csvSuppliers.length === 0 && !csvParsingDone && (
        <div className="bg-[#0075FF]/10 border border-[#0075FF]/30 rounded-[10px] p-[12px]">
          <p className="text-[13px] text-white text-right">
            שלב זה אופציונלי - ניתן להוסיף ספקים גם לאחר יצירת העסק.
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
        <p className="text-[14px] text-white/60 text-center">רק מנהלי מערכת יכולים ליצור עסקים חדשים</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] text-white pb-[100px]">
      {/* Header */}
      <div className="flex flex-col items-center gap-[10px] mb-[20px]">
        <h1 className="text-[24px] font-bold text-white">יצירת עסק חדש</h1>
      </div>

      {/* Steps Progress */}
      <div className="flex items-center justify-center mb-[25px]">
        {[1, 2, 3, 4, 5].map((step, index) => (
          <div key={step} className="flex items-center">
            {/* Connector line BEFORE the circle (except first) */}
            {index > 0 && (
              <div className={`w-[30px] h-[3px] transition-all duration-300 ${
                step <= currentStep
                  ? "bg-gradient-to-r from-[#00C853] to-[#69F0AE]"
                  : "bg-[#29318A]/50"
              }`} />
            )}
            <Button
              variant="ghost"
              type="button"
              onClick={() => step < currentStep && setCurrentStep(step)}
              suppressHydrationWarning
              className={`relative w-[36px] h-[36px] rounded-full flex items-center justify-center text-[14px] font-bold transition-all duration-300 z-10 ${
                step === currentStep
                  ? "bg-[#29318A] text-white shadow-[0_0_15px_rgba(41,49,138,0.4)]"
                  : step < currentStep
                  ? "bg-gradient-to-br from-[#00C853] to-[#69F0AE] text-white cursor-pointer hover:scale-110"
                  : "bg-[#29318A]/50 text-white/50"
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
          {currentStep === 5 && "ספקים"}
        </h2>
        <p className="text-[13px] text-white/50 mt-[4px]">
          {currentStep === 1 && "הזן את פרטי העסק הבסיסיים"}
          {currentStep === 2 && "הגדר את ימי ושעות הפעילות"}
          {currentStep === 3 && "הוסף מקורות הכנסה, כרטיסים ומוצרים"}
          {currentStep === 4 && "הוסף בעלים ועובדים לעסק"}
          {currentStep === 5 && "העלה רשימת ספקים מקובץ CSV"}
        </p>
      </div>

      {/* Form Container */}
      <div className="flex-1 bg-[#0F1535] rounded-[20px] p-[10px]">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        {currentStep === 5 && renderStep5()}
      </div>

      {/* Navigation Buttons */}
      <div className="fixed bottom-0 left-0 right-0 lg:right-[220px] bg-[#0F1535] border-t border-white/10 p-[15px] flex gap-[10px]">
        {currentStep > 1 && (
          <Button
            variant="outline"
            type="button"
            onClick={() => setCurrentStep(prev => prev - 1)}
            className="flex-1 bg-transparent border border-[#4C526B] text-white text-[16px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-white/10"
          >
            חזרה
          </Button>
        )}

        {currentStep < 5 ? (
          <Button
            variant="default"
            type="button"
            onClick={() => setCurrentStep(prev => prev + 1)}
            disabled={
              (currentStep === 1 && !canProceedStep1) ||
              (currentStep === 2 && !canProceedStep2) ||
              (currentStep === 3 && !canProceedStep3) ||
              (currentStep === 4 && !canProceedStep4)
            }
            className="flex-1 bg-[#29318A] text-white text-[16px] font-semibold py-[14px] rounded-[10px] transition-colors hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed"
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
                יוצר עסק...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12L10 17L19 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                צור עסק
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
