"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ToastProvider } from "@/components/ui/toast";
import { InstallPrompt } from "@/components/ui/install-prompt";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { ConsolidatedInvoiceModal } from "@/components/dashboard/ConsolidatedInvoiceModal";

// Context for sharing selected businesses across pages
interface DashboardContextType {
  selectedBusinesses: string[];
  setSelectedBusinesses: React.Dispatch<React.SetStateAction<string[]>>;
  toggleBusiness: (id: string) => void;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType>({
  selectedBusinesses: [],
  setSelectedBusinesses: () => {},
  toggleBusiness: () => {},
  isAdmin: false,
  refreshProfile: async () => {},
});

export const useDashboard = () => useContext(DashboardContext);

// Pages that exist (have actual page.tsx files)
const existingPages = ["/", "/expenses", "/suppliers", "/payments", "/goals", "/reports", "/ocr", "/settings", "/ai", "/admin/business/new", "/admin/business/edit", "/admin/users", "/admin/goals", "/admin/suppliers", "/admin/expenses"];

// Menu items for sidebar
const menuItems = [
  { id: 1, label: "דשבורד ראשי", href: "/", key: "dashboard" },
  { id: 2, label: "ניהול הוצאות", href: "/expenses", key: "expenses", requiresBusiness: true },
  { id: 3, label: "ניהול ספקים", href: "/suppliers", key: "suppliers", requiresBusiness: true },
  { id: 4, label: "ניהול תשלומים", href: "/payments", key: "payments", requiresBusiness: true },
  { id: 7, label: "דוח רווח הפסד", href: "/reports", key: "reports", requiresBusiness: true },
  { id: 8, label: "יעדים", href: "/goals", key: "goals", requiresBusiness: true },
  { id: 10, label: "הגדרות", href: "/settings", key: "settings" },
  { id: 11, label: "התנתקות", href: "#logout", key: "logout", isLogout: true },
];

// Admin menu items - only for admin users
const adminMenuItems = [
  { id: 100, label: "יצירת עסק חדש", href: "/admin/business/new", key: "admin-new-business" },
  { id: 101, label: "עריכת עסק", href: "/admin/business/edit", key: "admin-edit-business" },
  { id: 102, label: "ניהול משתמשים", href: "/admin/users", key: "admin-users" },
  { id: 103, label: "ניהול יעדים ותקציבים", href: "/admin/goals", key: "admin-goals" },
  { id: 104, label: "קליטת מסמכים OCR", href: "/ocr", key: "admin-ocr" },
  { id: 105, label: "ייבוא ספקים", href: "/admin/suppliers", key: "admin-suppliers" },
  { id: 106, label: "ייבוא הוצאות", href: "/admin/expenses", key: "admin-expenses" },
];

// Page titles mapping
const pageTitles: Record<string, string> = {
  "/": "דשבורד ראשי",
  "/expenses": "ניהול הוצאות",
  "/suppliers": "ניהול ספקים",
  "/payments": "ניהול תשלומים",
  "/ocr": "קליטת מסמכים OCR",
  "/reports": "דוח רווח הפסד",
  "/goals": "יעדים",
  "/settings": "הגדרות",
  "/admin/business/new": "יצירת עסק חדש",
  "/admin/business/edit": "עריכת עסק",
  "/admin/users": "ניהול משתמשים",
  "/admin/goals": "ניהול יעדים ותקציבים",
  "/admin/suppliers": "ייבוא ספקים",
  "/admin/expenses": "ייבוא הוצאות",
  "/ai": "עוזר AI",
};

// Dashboard icon component
const DashboardIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={active ? "text-white" : "text-white/70"}>
    <g>
      <path d="M11.8789 4.11979L12.1264 7.79975L12.2492 9.64935C12.2506 9.83958 12.2803 10.0286 12.3379 10.2102C12.4862 10.5627 12.8432 10.7867 13.2315 10.771L19.1491 10.3839C19.4053 10.3798 19.6528 10.4756 19.837 10.6504C19.9905 10.7961 20.0896 10.9867 20.1209 11.1917L20.1314 11.3161C19.8865 14.707 17.3961 17.5352 14.0123 18.2653C10.6284 18.9953 7.15844 17.4531 5.48631 14.4758C5.00425 13.6109 4.70314 12.6602 4.60068 11.6795C4.55788 11.3892 4.53904 11.0959 4.54433 10.8026C4.53904 7.16725 7.12787 4.02434 10.7517 3.26666C11.1879 3.19874 11.6155 3.42964 11.7904 3.82752C11.8356 3.91966 11.8655 4.01834 11.8789 4.11979Z" fill="currentColor"/>
      <path opacity="0.4" d="M21.321 7.61125L21.3147 7.64022L21.2968 7.68234L21.2993 7.79801C21.29 7.95117 21.2308 8.09855 21.129 8.21766C21.0227 8.34166 20.8777 8.4261 20.7179 8.4589L20.6205 8.47224L13.7931 8.91464C13.566 8.93704 13.3399 8.86379 13.1711 8.71321C13.0303 8.58761 12.9403 8.41819 12.9149 8.23561L12.4567 1.41816C12.4487 1.39511 12.4487 1.37012 12.4567 1.34706C12.4629 1.15914 12.5457 0.981516 12.6864 0.853863C12.827 0.726209 13.014 0.659169 13.2054 0.66772C17.2586 0.77084 20.6652 3.68547 21.321 7.61125Z" fill="currentColor"/>
    </g>
  </svg>
);

// Expenses bar chart icon
const ExpensesIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 22 22" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M2.69818 10.6682H4.49915V18.6682H2.69818V10.6682ZM17.1059 7.11263H18.9069V18.6682H17.1059V7.11263ZM9.90205 1.7793H11.703V18.6682H9.90205V1.7793Z" fill="currentColor"/>
  </svg>
);

// Tasks list icon
const TasksIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 19 18" fill="none" className={active ? "text-white" : "text-white/70"}>
    <rect x="0.0101929" y="0.666016" width="2.70145" height="2.66667" fill="currentColor"/>
    <rect x="0.0103149" y="7.99902" width="2.70145" height="2.66667" fill="currentColor"/>
    <rect x="0.0103149" y="15.333" width="2.70145" height="2.66667" fill="currentColor"/>
    <path d="M18.8077 1.33303L18.8077 3.11081L6.4261 3.11079L6.4261 1.33301L18.8077 1.33303ZM13.4048 15.5553L13.4048 17.333L6.4261 17.333L6.4261 15.5553L13.4048 15.5553ZM18.8077 8.44415L18.8077 10.2219L6.4261 10.2219L6.4261 8.44412L18.8077 8.44415Z" fill="currentColor"/>
  </svg>
);

// Insights gear/cog icon
const InsightsIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 28 20" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M25.0312 15.282C23.9987 15.111 23.0421 15.6867 22.6842 16.7195C22.6142 16.9214 22.5243 16.9781 22.3321 16.973C21.839 16.9609 21.3442 16.9523 20.8511 16.9747C20.5517 16.9884 20.4651 16.8819 20.4676 16.5734C20.48 14.708 20.4734 12.8426 20.4742 10.9772C20.4742 10.8749 20.4858 10.7718 20.494 10.6472C21.096 10.6472 21.6708 10.6575 22.2447 10.6421C22.4872 10.6361 22.6133 10.6876 22.7098 10.9591C23.1362 12.1595 24.4482 12.7043 25.554 12.1724C26.6607 11.6397 27.12 10.2382 26.5337 9.12809C26.1148 8.33415 25.4443 7.92601 24.5809 7.96811C23.6647 8.01365 23.0306 8.52404 22.6776 9.41336C22.6372 9.51475 22.5449 9.66683 22.4723 9.66941C21.8175 9.68917 21.162 9.68144 20.5204 9.68144C20.4981 9.62988 20.4825 9.61184 20.4825 9.59294C20.4792 7.5995 20.4783 5.6052 20.4734 3.61175C20.4734 3.40639 20.5756 3.36171 20.7463 3.36343C21.2708 3.36859 21.7961 3.37632 22.3198 3.36C22.5292 3.35312 22.6166 3.42186 22.69 3.63066C23.0727 4.72619 24.1686 5.31133 25.2241 5.00459C26.2145 4.71674 26.8495 3.78017 26.7827 2.70611C26.72 1.69822 25.9589 0.856165 24.9611 0.691191C24.007 0.53309 23.0355 1.13284 22.6941 2.11925C22.6175 2.34094 22.5226 2.41311 22.3024 2.40538C21.7986 2.38819 21.2947 2.39936 20.79 2.40022C19.9464 2.40194 19.5465 2.81867 19.5457 3.70197C19.544 5.56739 19.5457 7.4328 19.5457 9.29822V9.67113H16.8029C16.7204 9.05247 16.3716 8.74572 15.7911 8.70018C15.6278 8.6873 15.4662 8.64347 15.3029 8.62543C15.1231 8.60567 15.0176 8.53951 14.9714 8.32813C14.9104 8.04888 14.8007 7.77908 14.6943 7.51271C14.5772 7.21885 14.3191 6.92155 14.3447 6.64831C14.3702 6.37164 14.6729 6.1259 14.8452 5.86039C15.1363 5.41272 15.1017 4.97279 14.743 4.5741C14.5459 4.35586 14.3414 4.14277 14.1327 3.93741C13.7443 3.55418 13.313 3.52153 12.8743 3.84117C12.622 4.02505 12.3779 4.2201 12.1412 4.40054C11.827 4.2433 11.5367 4.0809 11.2349 3.9503C10.9331 3.81969 10.515 3.80766 10.3369 3.58168C10.1497 3.34367 10.1934 2.91319 10.1225 2.56949C10.0293 2.11925 9.71842 1.83656 9.28053 1.8168C8.93171 1.80133 8.58041 1.80133 8.23159 1.8168C7.80855 1.83656 7.49353 2.11581 7.40282 2.54543C7.34592 2.81696 7.30799 3.09363 7.2783 3.37031C7.26016 3.53786 7.19831 3.62292 7.03668 3.68565C6.5386 3.8807 6.05371 4.11183 5.55645 4.31118C5.46574 4.34812 5.32225 4.33867 5.23979 4.28626C5.01219 4.14191 4.81015 3.95545 4.58667 3.80251C4.20322 3.53872 3.79007 3.56192 3.45114 3.87898C3.1988 4.11527 2.95801 4.36617 2.73123 4.62824C2.41622 4.9917 2.3956 5.42647 2.66114 5.83891C2.78731 6.03482 2.92007 6.22643 3.06439 6.40687C3.19715 6.5727 3.23591 6.70932 3.10809 6.91554C2.95883 7.15613 2.80545 7.42335 2.76009 7.69745C2.63887 8.43898 2.24469 8.72081 1.5388 8.74057C1.03659 8.75432 0.745496 9.17878 0.735601 9.70808C0.729828 10.0191 0.729004 10.3302 0.735601 10.6404C0.747146 11.1653 1.04896 11.5194 1.552 11.6079C1.79526 11.6508 2.04348 11.6723 2.28098 11.7367C2.37416 11.7617 2.48137 11.8613 2.52012 11.955C2.6298 12.2196 2.6933 12.504 2.79968 12.7696C2.92255 13.0746 3.20128 13.3805 3.17489 13.6614C3.14685 13.9579 2.83514 14.2234 2.65537 14.5078C2.38818 14.9305 2.42447 15.367 2.76009 15.7417C2.95636 15.9608 3.16252 16.1713 3.3695 16.3801C3.7744 16.7882 4.21146 16.8192 4.67656 16.4729C4.91818 16.2933 5.15485 16.1069 5.33957 15.9651C5.9127 16.2022 6.42975 16.4368 6.96164 16.6267C7.18182 16.7049 7.27748 16.8063 7.28737 17.046C7.29644 17.2694 7.34345 17.4919 7.38633 17.7119C7.48611 18.218 7.78711 18.5041 8.27612 18.5325C8.60433 18.5514 8.93501 18.5523 9.26321 18.5299C9.73821 18.4973 10.0351 18.2129 10.1307 17.7222C10.1794 17.4705 10.2173 17.2161 10.2429 16.9609C10.2602 16.7899 10.3229 16.6997 10.4911 16.6533C10.7484 16.582 11.0016 16.4892 11.2473 16.3809C11.5483 16.2486 11.8501 15.9556 12.1305 15.9823C12.4133 16.0089 12.6632 16.3509 12.9378 16.539C13.3229 16.8028 13.7567 16.7616 14.0981 16.4316C14.324 16.2134 14.5426 15.9848 14.7537 15.7503C15.1 15.367 15.1347 14.9237 14.8543 14.4898C14.7166 14.2767 14.5714 14.0679 14.4139 13.8702C14.3042 13.7328 14.31 13.6254 14.3867 13.469C14.5632 13.1072 14.7759 12.7455 14.8568 12.3571C14.9623 11.8484 15.2072 11.6646 15.6863 11.6517C16.2908 11.6354 16.7336 11.357 16.8021 10.6721H19.5473C19.5473 10.8234 19.5473 10.9505 19.5473 11.0768C19.5473 12.9311 19.5465 14.7862 19.5473 16.6404C19.5473 17.516 19.953 17.9345 20.7991 17.9396C21.2931 17.9422 21.787 17.9525 22.2802 17.9345C22.5094 17.9259 22.6174 17.9903 22.7007 18.2292C23.0619 19.2603 24.0977 19.848 25.098 19.6186C26.1205 19.384 26.8091 18.4749 26.7877 17.3906C26.767 16.3595 26.0043 15.4418 25.0336 15.282H25.0312ZM24.6725 8.92531C25.3272 8.92617 25.8632 9.49241 25.8599 10.1772C25.8558 10.8603 25.3099 11.4197 24.656 11.4102C24.0127 11.4008 23.4883 10.8491 23.4833 10.1764C23.4784 9.49412 24.0202 8.92445 24.6725 8.92531ZM24.6494 1.63893C25.3058 1.62691 25.8525 2.18026 25.8591 2.86335C25.8657 3.54903 25.3338 4.11527 24.6782 4.12043C24.0251 4.12558 23.4817 3.5602 23.4825 2.8771C23.4833 2.20346 24.0045 1.6501 24.6494 1.63893ZM15.8397 10.6464C15.4794 10.7065 15.1099 10.783 14.7364 10.8259C14.4156 10.8629 14.2399 11.0124 14.1756 11.3518C14.0404 12.0624 13.7798 12.7249 13.3889 13.3255C13.2132 13.5953 13.224 13.8342 13.4153 14.0876C13.6487 14.3987 13.8672 14.7218 14.1014 15.0526C13.8771 15.2777 13.6643 15.4899 13.4326 15.7219C13.1308 15.4908 12.8116 15.2588 12.5057 15.0105C12.2699 14.8188 12.048 14.8137 11.8006 14.9855C11.2226 15.3885 10.5934 15.6738 9.90726 15.8044C9.56833 15.8697 9.41825 16.0733 9.38279 16.4145C9.3498 16.7332 9.30197 17.0512 9.24837 17.3674C9.236 17.4387 9.17828 17.5555 9.13457 17.559C8.88965 17.5787 8.64143 17.5822 8.39652 17.5607C8.34786 17.5564 8.28519 17.4266 8.27117 17.3467C8.21592 17.0314 8.16974 16.7126 8.13511 16.3938C8.09882 16.0647 7.94626 15.8697 7.623 15.8078C6.93773 15.6755 6.30688 15.3937 5.7288 14.9907C5.46822 14.8085 5.24144 14.8223 4.99817 15.0216C4.70047 15.2657 4.38959 15.4916 4.08364 15.7262C3.86099 15.4976 3.65153 15.282 3.42476 15.0474C3.65648 14.7192 3.88161 14.3892 4.11828 14.0687C4.2997 13.823 4.303 13.5901 4.13725 13.3332C3.73647 12.7128 3.47341 12.0306 3.33322 11.2985C3.27962 11.0184 3.12211 10.8741 2.85493 10.8354C2.469 10.7795 2.08389 10.7151 1.68146 10.6515V9.69175C2.0674 9.62731 2.45745 9.55255 2.85081 9.49842C3.12129 9.46061 3.27879 9.3197 3.3324 9.0413C3.47506 8.29806 3.74554 7.60809 4.15209 6.97826C4.31207 6.7308 4.29228 6.50396 4.12075 6.27025C3.88408 5.94803 3.65813 5.61722 3.42805 5.28985C3.65153 5.05614 3.85934 4.83789 4.07952 4.60676C4.39041 4.84477 4.70295 5.06903 4.999 5.31391C5.24226 5.51497 5.46987 5.5313 5.72963 5.34828C6.31512 4.93585 6.95669 4.65831 7.65269 4.52083C7.92894 4.46584 8.08645 4.30001 8.12438 4.00701C8.16892 3.6676 8.20767 3.32649 8.27694 2.99224C8.29508 2.90632 8.41631 2.78946 8.49795 2.78173C9.22775 2.71556 9.22858 2.72158 9.32259 3.46139C9.32506 3.48287 9.33001 3.50349 9.33001 3.52497C9.33166 4.17284 9.59967 4.50107 10.252 4.63683C10.7888 4.74853 11.2918 5.0759 11.7874 5.35C12.0612 5.50123 12.2773 5.51841 12.5214 5.31907C12.8191 5.07504 13.1291 4.84734 13.4408 4.60762C13.6569 4.83961 13.8622 5.05958 14.0898 5.3036C13.8705 5.61379 13.6445 5.94374 13.407 6.26423C13.2256 6.50912 13.2182 6.74111 13.3848 6.99889C13.7798 7.60981 14.0437 8.28173 14.183 9.00264C14.2424 9.31025 14.3991 9.46405 14.6968 9.50186C15.0736 9.54912 15.448 9.62129 15.8422 9.68488V10.6446L15.8397 10.6464ZM24.6584 18.6915C23.9971 18.6863 23.4693 18.1226 23.4825 17.4361C23.4957 16.7564 24.0152 16.2254 24.6675 16.2246C25.3322 16.2237 25.8608 16.7728 25.8583 17.4619C25.8558 18.1484 25.3206 18.6966 24.6576 18.6915H24.6584Z" fill="currentColor" stroke="currentColor" strokeWidth="0.466667"/>
    <path d="M12.8847 8.52987C12.7206 8.18961 12.5053 7.87427 12.2406 7.59845C12.2382 7.59587 12.2349 7.5933 12.2324 7.59072C11.2618 6.57595 9.79227 6.25718 8.48439 6.78819C8.01352 6.97894 7.59708 7.27881 7.2565 7.65173C6.95468 7.9748 6.71636 8.34771 6.55308 8.77304C6.37661 9.21039 6.28013 9.68469 6.28095 10.171C6.28177 10.7759 6.42774 11.3508 6.68502 11.8577C7.03962 12.5778 7.61604 13.1406 8.31122 13.4731C8.32029 13.4774 8.32853 13.4817 8.3376 13.486C8.36729 13.4997 8.39698 13.5135 8.42667 13.5264C8.45058 13.5367 8.47367 13.547 8.49759 13.5564C8.50666 13.5599 8.51573 13.5633 8.5248 13.5667C8.72024 13.6449 8.92475 13.7059 9.13586 13.7463C9.13916 13.7463 9.14163 13.7472 9.14493 13.748C9.18534 13.7558 9.22574 13.7627 9.26615 13.7695C9.39892 13.7901 9.53416 13.803 9.67105 13.8082C9.81866 13.8133 9.96545 13.8082 10.1106 13.7936C10.1172 13.7936 10.1246 13.7919 10.1312 13.791C10.1996 13.7841 10.2673 13.7755 10.3341 13.7635C10.3506 13.7609 10.367 13.7575 10.3835 13.7541C10.4388 13.7438 10.494 13.7326 10.5493 13.7197C10.5658 13.7154 10.5823 13.712 10.5988 13.7077C11.6378 13.4439 12.5268 12.6826 12.977 11.6154C13.1535 11.197 13.2459 10.7502 13.2591 10.3025C13.2813 9.69328 13.1519 9.08322 12.883 8.53073L12.8847 8.52987ZM10.8833 12.5803C10.8074 12.6061 10.7357 12.6439 10.6606 12.6723C9.93988 12.9498 9.17791 12.8665 8.55284 12.5133C8.54294 12.5073 8.53304 12.5021 8.52315 12.4961C8.49759 12.4815 8.47202 12.4661 8.44646 12.4497C8.43409 12.442 8.42172 12.4334 8.40935 12.4257C8.38791 12.4119 8.36647 12.3973 8.34585 12.3827C8.33101 12.3724 8.31616 12.3621 8.30215 12.3509C8.284 12.3372 8.26504 12.3234 8.24689 12.3097C8.23123 12.2976 8.21556 12.2856 8.20071 12.2727C8.18505 12.2598 8.16938 12.247 8.15371 12.2332C8.13639 12.2186 8.11907 12.2031 8.10176 12.1885C8.09021 12.1782 8.07949 12.1679 8.06877 12.1576C8.04733 12.1378 8.02589 12.1172 8.00527 12.0966C8.00198 12.0931 7.9995 12.0906 7.9962 12.0871C7.78757 11.8766 7.61852 11.6317 7.48163 11.3585C7.42473 11.2399 7.37525 11.1162 7.33484 10.9856C7.1526 10.403 7.17486 9.80413 7.35958 9.27054C7.39257 9.20094 7.41648 9.12618 7.44782 9.05573C8.05558 7.67922 9.64466 7.10697 10.9443 7.79608C11.1018 7.87942 11.2469 7.97738 11.3797 8.08822C11.3913 8.09767 11.402 8.10712 11.4127 8.11658C11.4292 8.13032 11.4457 8.14493 11.4613 8.15954C11.8349 8.50152 12.1178 8.96121 12.2505 9.50425C12.3759 10.0155 12.3503 10.5078 12.2085 10.9916C12.159 11.1506 12.0955 11.3069 12.0155 11.4599C11.75 11.9677 11.3484 12.3475 10.8841 12.5786L10.8833 12.5803Z" fill="currentColor" stroke="currentColor" strokeWidth="0.466667"/>
  </svg>
);

// Reports (Profit & Loss) trend line icon
const ReportsIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 22 22" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M18.9074 18.4449H2.69867V5.11157" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M18.9074 6.88916L11.7035 13.1114L8.10157 9.55583L2.69867 14.0003" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Surveys checklist icon
const SurveysIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 27 27" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M21.7387 27.0007H5.89474C5.81227 26.9824 5.73045 26.9577 5.64734 26.946C4.71379 26.8171 3.85368 26.4902 3.0928 25.9284C1.46279 24.7246 0.652939 23.0853 0.650362 21.0475C0.643275 16.1276 0.647785 11.207 0.648429 6.28711C0.648429 6.14844 0.648429 6.00911 0.660026 5.87109C0.881656 3.36068 2.13541 1.61719 4.45737 0.696615C4.91351 0.516276 5.41475 0.451823 5.89474 0.333984C11.1758 0.333984 16.4576 0.333984 21.7387 0.333984C21.8128 0.351562 21.8856 0.374349 21.9603 0.386068C24.2211 0.752604 25.7899 2.00521 26.6197 4.16667C26.8001 4.63672 26.8664 5.15169 26.9856 5.64583V21.6875C26.9676 21.7715 26.945 21.8548 26.9315 21.9395C26.5598 24.2148 25.3253 25.7962 23.1992 26.6302C22.7347 26.8125 22.227 26.8802 21.7393 27.0007H21.7387ZM13.809 25.334C16.2521 25.334 18.6958 25.3379 21.1389 25.3327C23.5355 25.3275 25.3363 23.5091 25.3389 21.0833C25.3434 16.1361 25.344 11.1882 25.3389 6.24089C25.3363 3.82943 23.5362 2.00521 21.1556 2.00195C16.2604 1.99609 11.3652 1.99544 6.47072 2.00195C4.10366 2.00521 2.30099 3.82878 2.29712 6.22396C2.29003 11.1888 2.28875 16.1536 2.30485 21.1185C2.30614 21.5872 2.38345 22.0768 2.53228 22.5202C3.11341 24.2526 4.64485 25.3281 6.47973 25.332C8.92281 25.3372 11.3659 25.3333 13.8096 25.3333L13.809 25.334Z" fill="currentColor"/>
    <path d="M21.2123 7.01855V8.65397H11.3685V7.01855H21.2123Z" fill="currentColor"/>
    <path d="M11.369 12.8389H21.2038V14.4834H11.369V12.8389Z" fill="currentColor"/>
    <path d="M11.36 20.3164V18.6797H21.2039V20.3164H11.36Z" fill="currentColor"/>
    <path d="M8.05553 9.5C7.78172 9.5 7.50726 9.50716 7.23344 9.4987C6.76377 9.48438 6.4223 9.14714 6.41328 8.67383C6.40233 8.11003 6.40169 7.54622 6.41393 6.98242C6.42424 6.52279 6.76506 6.18164 7.22056 6.17188C7.77721 6.16016 8.3345 6.16016 8.89115 6.17188C9.34665 6.18164 9.68747 6.52279 9.69714 6.98242C9.70938 7.55469 9.71067 8.1276 9.69585 8.69987C9.6849 9.14648 9.34601 9.47917 8.90339 9.4974C8.6212 9.50911 8.33837 9.49935 8.05553 9.49935C8.05553 9.49935 8.05553 9.5 8.05553 9.50065V9.5Z" fill="currentColor"/>
    <path d="M9.70093 13.6661C9.70093 13.935 9.70608 14.2039 9.70029 14.4727C9.68933 14.9786 9.35624 15.3243 8.86015 15.3321C8.3209 15.3406 7.781 15.3412 7.2411 15.3321C6.75854 15.3237 6.41965 14.9792 6.41192 14.4897C6.4029 13.9434 6.40355 13.3966 6.41192 12.8503C6.41965 12.3601 6.75661 12.0131 7.23788 12.0046C7.78615 11.9949 8.33443 11.9942 8.8827 12.0046C9.35109 12.0138 9.68418 12.3588 9.699 12.8334C9.70737 13.1108 9.70028 13.3888 9.70093 13.6661Z" fill="currentColor"/>
    <path d="M8.0536 17.8346C8.31904 17.8346 8.58513 17.8294 8.85057 17.8352C9.35052 17.8463 9.69134 18.1835 9.69907 18.6855C9.70745 19.2317 9.70809 19.7786 9.69907 20.3248C9.6907 20.8131 9.35052 21.1562 8.86667 21.164C8.32742 21.1731 7.78752 21.1725 7.24762 21.164C6.76313 21.1562 6.42102 20.815 6.41264 20.3274C6.40298 19.7727 6.40233 19.2174 6.41264 18.662C6.42166 18.1881 6.76248 17.8502 7.23151 17.8352C7.50533 17.8268 7.77979 17.8339 8.0536 17.8333V17.8346Z" fill="currentColor"/>
  </svg>
);

// Goals bar chart icon
const GoalsIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 22 22" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M2.69806 10.6682H4.49903V18.6682H2.69806V10.6682ZM17.1058 7.11263H18.9068V18.6682H17.1058V7.11263ZM9.90192 1.7793H11.7029V18.6682H9.90192V1.7793Z" fill="currentColor"/>
  </svg>
);

// Payments bar chart icon
const PaymentsIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 22 23" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M2.69806 11.1681H4.49903V19.5431H2.69806V11.1681ZM17.1058 7.44588H18.9068V19.5431H17.1058V7.44588ZM9.90192 1.86255H11.7029V19.5431H9.90192V1.86255Z" fill="currentColor"/>
  </svg>
);

// Suppliers list icon
const SuppliersIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 27 27" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M21.7387 27.0007H5.89474C5.81227 26.9824 5.73045 26.9577 5.64734 26.946C4.71379 26.8171 3.85368 26.4902 3.0928 25.9284C1.46279 24.7246 0.652939 23.0853 0.650362 21.0475C0.643275 16.1276 0.647785 11.207 0.648429 6.28711C0.648429 6.14844 0.648429 6.00911 0.660026 5.87109C0.881656 3.36068 2.13541 1.61719 4.45737 0.696615C4.91351 0.516276 5.41475 0.451823 5.89474 0.333984C11.1758 0.333984 16.4576 0.333984 21.7387 0.333984C21.8128 0.351562 21.8856 0.374349 21.9603 0.386068C24.2211 0.752604 25.7899 2.00521 26.6197 4.16667C26.8001 4.63672 26.8664 5.15169 26.9856 5.64583V21.6875C26.9676 21.7715 26.945 21.8548 26.9315 21.9395C26.5598 24.2148 25.3253 25.7962 23.1992 26.6302C22.7347 26.8125 22.227 26.8802 21.7393 27.0007H21.7387ZM13.809 25.334C16.2521 25.334 18.6958 25.3379 21.1389 25.3327C23.5355 25.3275 25.3363 23.5091 25.3389 21.0833C25.3434 16.1361 25.344 11.1882 25.3389 6.24089C25.3363 3.82943 23.5362 2.00521 21.1556 2.00195C16.2604 1.99609 11.3652 1.99544 6.47072 2.00195C4.10366 2.00521 2.30099 3.82878 2.29712 6.22396C2.29003 11.1888 2.28875 16.1536 2.30485 21.1185C2.30614 21.5872 2.38345 22.0768 2.53228 22.5202C3.11341 24.2526 4.64485 25.3281 6.47973 25.332C8.92281 25.3372 11.3659 25.3333 13.8096 25.3333L13.809 25.334Z" fill="currentColor"/>
    <path d="M21.2123 7.01855V8.65397H11.3685V7.01855H21.2123Z" fill="currentColor"/>
    <path d="M11.369 12.8389H21.2038V14.4834H11.369V12.8389Z" fill="currentColor"/>
    <path d="M11.36 20.3164V18.6797H21.2039V20.3164H11.36Z" fill="currentColor"/>
    <path d="M8.05553 9.5C7.78172 9.5 7.50726 9.50716 7.23344 9.4987C6.76377 9.48438 6.4223 9.14714 6.41328 8.67383C6.40233 8.11003 6.40169 7.54622 6.41393 6.98242C6.42424 6.52279 6.76506 6.18164 7.22056 6.17188C7.77721 6.16016 8.3345 6.16016 8.89115 6.17188C9.34665 6.18164 9.68747 6.52279 9.69714 6.98242C9.70938 7.55469 9.71067 8.1276 9.69585 8.69987C9.6849 9.14648 9.34601 9.47917 8.90339 9.4974C8.6212 9.50911 8.33837 9.49935 8.05553 9.49935C8.05553 9.49935 8.05553 9.5 8.05553 9.50065V9.5Z" fill="currentColor"/>
    <path d="M9.70093 13.6661C9.70093 13.935 9.70608 14.2039 9.70029 14.4727C9.68933 14.9786 9.35624 15.3243 8.86015 15.3321C8.3209 15.3406 7.781 15.3412 7.2411 15.3321C6.75854 15.3237 6.41965 14.9792 6.41192 14.4897C6.4029 13.9434 6.40355 13.3966 6.41192 12.8503C6.41965 12.3601 6.75661 12.0131 7.23788 12.0046C7.78615 11.9949 8.33443 11.9942 8.8827 12.0046C9.35109 12.0138 9.68418 12.3588 9.699 12.8334C9.70737 13.1108 9.70028 13.3888 9.70093 13.6661Z" fill="currentColor"/>
    <path d="M8.0536 17.8346C8.31904 17.8346 8.58513 17.8294 8.85057 17.8352C9.35052 17.8463 9.69134 18.1835 9.69907 18.6855C9.70745 19.2317 9.70809 19.7786 9.69907 20.3248C9.6907 20.8131 9.35052 21.1562 8.86667 21.164C8.32742 21.1731 7.78752 21.1725 7.24762 21.164C6.76313 21.1562 6.42102 20.815 6.41264 20.3274C6.40298 19.7727 6.40233 19.2174 6.41264 18.662C6.42166 18.1881 6.76248 17.8502 7.23151 17.8352C7.50533 17.8268 7.77979 17.8339 8.0536 17.8333V17.8346Z" fill="currentColor"/>
  </svg>
);

// Logout icon
const LogoutIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 19 20" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path fillRule="evenodd" clipRule="evenodd" d="M13.715 14.4957L16.7963 10.7805C16.9434 10.607 17.0187 10.388 17.0188 10.1679C17.0189 10.0173 16.9838 9.86613 16.9124 9.72864C16.8807 9.66737 16.8419 9.60916 16.7963 9.55534L13.715 5.84007C13.3914 5.44984 12.8229 5.40462 12.4453 5.73906C12.0677 6.0735 12.0239 6.66096 12.3475 7.05119L14.1606 9.23729L7.18667 9.23729C6.68935 9.23729 6.28619 9.65391 6.28619 10.1678C6.28619 10.6818 6.68935 11.0984 7.18667 11.0984L14.1607 11.0984L12.3475 13.2846C12.0239 13.6749 12.0677 14.2623 12.4453 14.5968C12.8229 14.9312 13.3914 14.886 13.715 14.4957ZM8.01397 4.5845C8.51129 4.5845 8.91445 5.00112 8.91445 5.51506L8.91445 6.91089C8.91445 7.42482 9.31761 7.84144 9.81493 7.84144C10.3123 7.84144 10.7154 7.42482 10.7154 6.91089L10.7154 5.51506C10.7154 3.97326 9.50594 2.72339 8.01397 2.72339L5.31252 2.72339C3.82055 2.72339 2.61107 3.97326 2.61107 5.51505L2.61107 14.8206C2.61107 16.3624 3.82055 17.6123 5.31252 17.6123L8.01397 17.6123C9.50594 17.6123 10.7154 16.3624 10.7154 14.8206L10.7154 13.4248C10.7154 12.9108 10.3123 12.4942 9.81493 12.4942C9.31761 12.4942 8.91445 12.9108 8.91445 13.4248L8.91445 14.8206C8.91445 15.3345 8.51129 15.7512 8.01397 15.7512L5.31252 15.7512C4.8152 15.7512 4.41204 15.3345 4.41204 14.8206L4.41204 5.51505C4.41204 5.00112 4.8152 4.5845 5.31252 4.5845L8.01397 4.5845Z" fill="currentColor"/>
  </svg>
);

// Menu icon component
const MenuIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={active ? "text-white" : "text-white/70"}>
    <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

// Settings gear icon
const SettingsIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 22 24" fill="none" className={active ? "text-white" : "text-white/70"}>
    <path d="M10.8156 8.11092C11.7708 8.11092 12.687 8.50308 13.3625 9.20114C14.038 9.89919 14.4175 10.8459 14.4175 11.8331C14.4175 12.8203 14.038 13.7671 13.3625 14.4652C12.687 15.1632 11.7708 15.5554 10.8156 15.5554C9.86026 15.5554 8.9441 15.1632 8.2686 14.4652C7.59311 13.7671 7.21362 12.8203 7.21362 11.8331C7.21362 10.8459 7.59311 9.89919 8.2686 9.20114C8.9441 8.50308 9.86026 8.11092 10.8156 8.11092ZM10.8156 9.97203C10.3379 9.97203 9.87982 10.1681 9.54208 10.5171C9.20433 10.8662 9.01459 11.3395 9.01459 11.8331C9.01459 12.3267 9.20433 12.8001 9.54208 13.1491C9.87982 13.4982 10.3379 13.6943 10.8156 13.6943C11.2932 13.6943 11.7513 13.4982 12.089 13.1491C12.4268 12.8001 12.6165 12.3267 12.6165 11.8331C12.6165 11.3395 12.4268 10.8662 12.089 10.5171C11.7513 10.1681 11.2932 9.97203 10.8156 9.97203ZM9.01459 21.1387C8.78947 21.1387 8.60036 20.9712 8.56434 20.7479L8.23117 18.2819C7.66386 18.0493 7.1776 17.7329 6.70935 17.3606L4.46715 18.3005C4.26904 18.375 4.02591 18.3005 3.91785 18.0958L2.11689 14.8761C2.06177 14.7802 2.04234 14.6668 2.06223 14.5572C2.08212 14.4476 2.13996 14.3492 2.22494 14.2805L4.12496 12.7358L4.06193 11.8331L4.12496 10.9026L2.22494 9.38578C2.13996 9.31705 2.08212 9.21867 2.06223 9.10906C2.04234 8.99945 2.06177 8.88611 2.11689 8.79023L3.91785 5.5705C4.02591 5.36578 4.26904 5.28203 4.46715 5.36578L6.70935 6.29634C7.1776 5.93342 7.66386 5.61703 8.23117 5.38439L8.56434 2.91842C8.60036 2.69509 8.78947 2.52759 9.01459 2.52759H12.6165C12.8416 2.52759 13.0307 2.69509 13.0668 2.91842L13.3999 5.38439C13.9672 5.61703 14.4535 5.93342 14.9218 6.29634L17.164 5.36578C17.3621 5.28203 17.6052 5.36578 17.7133 5.5705L19.5142 8.79023C19.6313 8.99495 19.5773 9.2462 19.4062 9.38578L17.5061 10.9026L17.5692 11.8331L17.5061 12.7637L19.4062 14.2805C19.5773 14.4201 19.6313 14.6713 19.5142 14.8761L17.7133 18.0958C17.6052 18.3005 17.3621 18.3843 17.164 18.3005L14.9218 17.37C14.4535 17.7329 13.9672 18.0493 13.3999 18.2819L13.0668 20.7479C13.0307 20.9712 12.8416 21.1387 12.6165 21.1387H9.01459ZM10.1402 4.3887L9.80701 6.81745C8.72643 7.05009 7.77192 7.64564 7.07855 8.47384L4.90838 7.50606L4.23302 8.71578L6.13304 10.1581C5.77285 11.2438 5.77285 12.4225 6.13304 13.5081L4.22402 14.9598L4.89938 16.1695L7.08755 15.2018C7.78092 16.0206 8.72643 16.6162 9.79801 16.8395L10.1312 19.2776H11.4999L11.8331 16.8488C12.9047 16.6162 13.8502 16.0206 14.5436 15.2018L16.7317 16.1695L17.4071 14.9598L15.4981 13.5175C15.8583 12.4287 15.8583 11.2469 15.4981 10.1581L17.3981 8.71578L16.7227 7.50606L14.5526 8.47384C13.845 7.62733 12.8852 7.04792 11.8241 6.82676L11.4909 4.3887H10.1402Z" fill="currentColor"/>
  </svg>
);

// Notification type
interface Notification {
  id: number;
  user_id: string;
  title: string;
  message: string | null;
  type: string | null;
  is_read: boolean;
  link: string | null;
  created_at: string;
  business_id: string | null;
}

// User profile type
interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin?: boolean;
}


export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showBusinessRequiredPopup, setShowBusinessRequiredPopup] = useState(false);
  const [selectedBusinesses, setSelectedBusinesses] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isCoordinatorModalOpen, setIsCoordinatorModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileImageLoaded, setProfileImageLoaded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Set mounted state after hydration and restore client-only state
  useEffect(() => {
    // Restore isAdmin from localStorage to avoid flash before profile fetch
    const savedAdmin = localStorage.getItem('isAdmin') === 'true';
    if (savedAdmin) {
      setIsAdmin(true);
    }
    setIsMounted(true);
  }, []);

  // Fetch user profile from Supabase
  const fetchUserProfile = useCallback(async () => {
    setIsLoadingProfile(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // Get profile from profiles table (including is_admin)
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url, is_admin")
        .eq("id", user.id)
        .single();

      if (profile) {
        // Reset image loaded state when avatar changes
        setProfileImageLoaded(prev => {
          if (profile.avatar_url !== userProfile?.avatar_url) return false;
          return prev;
        });
        setUserProfile(profile);
        // Check if user is admin from profile
        const adminStatus = profile.is_admin === true;
        setIsAdmin(adminStatus);
        localStorage.setItem('isAdmin', String(adminStatus));
      }
    }
    setIsLoadingProfile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    fetchUserProfile();
  }, [isMounted, fetchUserProfile]);

  // Fetch business name for sidebar display
  useEffect(() => {
    const fetchBusinessName = async () => {
      if (selectedBusinesses.length === 0) {
        setBusinessName(null);
        return;
      }

      const supabase = createClient();
      const { data: business } = await supabase
        .from("businesses")
        .select("name")
        .eq("id", selectedBusinesses[0])
        .single();

      if (business) {
        setBusinessName(business.name);
      }
    };

    fetchBusinessName();
  }, [selectedBusinesses]);

  // Fetch notifications from Supabase
  const fetchNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!error && data) {
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.is_read).length);
      }
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Global Realtime subscription for all important tables
  useMultiTableRealtime(
    ["notifications", "businesses", "daily_entries", "tasks", "invoices", "payments", "suppliers", "goals"],
    fetchNotifications,
    true
  );

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("selectedBusinesses");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSelectedBusinesses(parsed);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
    setIsHydrated(true);
  }, []);

  // Save to localStorage when selectedBusinesses changes
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem("selectedBusinesses", JSON.stringify(selectedBusinesses));
    }
  }, [selectedBusinesses, isHydrated]);

  const toggleBusiness = (id: string) => {
    setSelectedBusinesses(prev =>
      prev.includes(id)
        ? prev.filter(businessId => businessId !== id)
        : [...prev, id]
    );
  };

  const title = pageTitles[pathname] || "דשבורד";
  const activeKey = menuItems.find(item => item.href === pathname)?.key || "dashboard";
  const isAdminPage = adminMenuItems.some(item => pathname.startsWith(item.href));

  const handleMenuClick = (item: typeof menuItems[0], e: React.MouseEvent) => {
    if (item.requiresBusiness && selectedBusinesses.length === 0) {
      e.preventDefault();
      setIsMenuOpen(false);
      setShowBusinessRequiredPopup(true);
    } else {
      setIsMenuOpen(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      localStorage.removeItem("selectedBusinesses");
      router.push("/login");
    } catch (error) {
      console.error("Error logging out:", error);
      setIsLoggingOut(false);
    }
  };

  const markNotificationAsRead = async (notificationId: number) => {
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);

    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllAsRead = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "עכשיו";
    if (diffMins < 60) return `לפני ${diffMins} דקות`;
    if (diffHours < 24) return `לפני ${diffHours} שעות`;
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return date.toLocaleDateString("he-IL");
  };

  return (
    <ToastProvider>
    <DashboardContext.Provider value={{ selectedBusinesses, setSelectedBusinesses, toggleBusiness, isAdmin, refreshProfile: fetchUserProfile }}>
      <div className="min-h-screen bg-[#0F1535]">
        {/* Sidebar Overlay - Mobile only */}
        {isMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[1502] lg:hidden"
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar Menu - Slide-in on mobile, permanent on desktop */}
        <nav
          role="navigation"
          aria-label="תפריט ראשי"
          className={`fixed top-0 right-0 h-full w-[50%] max-w-[250px] bg-[#111056] z-[1503] transform transition-transform duration-300 ease-in-out p-[20px] pb-[55px] lg:translate-x-0 lg:w-[220px] lg:max-w-none lg:shadow-lg ${
            isMenuOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <button
            type="button"
            title="סגור תפריט"
            onClick={() => setIsMenuOpen(false)}
            className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white transition-colors lg:hidden"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="flex flex-col h-full overflow-y-auto mt-[40px] lg:mt-[10px]">
            {/* Amazpen System Logo - Fixed/Static */}
            <div className="flex justify-center my-[15px]">
              <img
                src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=88,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
                alt="Amazpen"
                className="w-[143px] h-[66px] object-contain"
              />
            </div>

            {/* Business Name */}
            <div className="flex items-center justify-end gap-[10px] p-[7px] rounded-[10px] mb-[10px]">
              <img
                src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/f1725470298167x485496868385594050/userlogin.svg"
                alt=""
                className="w-[30px] h-[30px] rounded-[5px]"
              />
              <span className="text-white text-[16px] font-medium text-right flex-1" suppressHydrationWarning>
                {businessName || "עסק"}
              </span>
            </div>

            <div className="flex flex-col gap-[5px]">
              {menuItems.map((item) => {
                // Handle logout button
                if (item.isLogout) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 opacity-75 hover:bg-[#29318A]/50 hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <LogoutIcon />
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">
                        {isLoggingOut ? "מתנתק..." : item.label}
                      </span>
                    </button>
                  );
                }

                const pageExists = existingPages.includes(item.href);

                const IconComponent = item.key === "settings" ? SettingsIcon : item.key === "dashboard" ? DashboardIcon : item.key === "expenses" ? ExpensesIcon : item.key === "suppliers" ? SuppliersIcon : item.key === "payments" ? PaymentsIcon : item.key === "insights" ? InsightsIcon : item.key === "tasks" ? TasksIcon : item.key === "reports" ? ReportsIcon : item.key === "goals" ? GoalsIcon : item.key === "surveys" ? SurveysIcon : MenuIcon;

                if (!pageExists) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] opacity-30 cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <IconComponent />
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={(e) => handleMenuClick(item, e)}
                    className={`flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 ${
                      activeKey === item.key
                        ? 'bg-[#29318A] opacity-100'
                        : 'opacity-75 hover:bg-[#29318A]/50 hover:opacity-100'
                    }`}
                  >
                    <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                      <IconComponent active={activeKey === item.key} />
                    </div>
                    <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Admin Section - Collapsible, show only for admin users */}
            {isAdmin && (
            <div className="mt-[20px] pt-[15px] border-t border-white/10">
              <button
                type="button"
                onClick={() => setIsAdminMenuOpen((prev) => !prev)}
                className="flex items-center justify-between w-full px-[7px] mb-[4px] cursor-pointer group"
              >
                <div className="flex items-center gap-[8px]">
                  <span className="text-[#FFA412] text-[12px] font-bold">ניהול מערכת</span>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  className={`text-[#FFA412] transition-transform duration-200 ${isAdminMenuOpen || isAdminPage ? 'rotate-180' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className={`overflow-hidden transition-all duration-200 ${isAdminMenuOpen || isAdminPage ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
              {adminMenuItems.map((item) => {
                const pageExists = existingPages.includes(item.href);

                if (!pageExists) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] opacity-30 cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white/70">
                          <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 ${
                      activeKey === item.key
                        ? 'bg-[#FFA412]/20 opacity-100'
                        : 'opacity-75 hover:bg-[#FFA412]/10 hover:opacity-100'
                    }`}
                  >
                    <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={activeKey === item.key ? "text-[#FFA412]" : "text-white/70"}>
                        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <span className={`text-[14px] font-medium text-right flex-1 ${activeKey === item.key ? "text-[#FFA412]" : "text-white"}`}>{item.label}</span>
                  </Link>
                );
              })}
              </div>
            </div>
            )}

          </div>
        </nav>

        {/* Business Required Popup */}
        {showBusinessRequiredPopup && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-[2001]"
              onClick={() => setShowBusinessRequiredPopup(false)}
            />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-40px)] max-w-[380px] bg-[#29318A] rounded-[15px] p-[25px] z-[2002] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-white/5">
              <div className="flex flex-col items-center justify-center gap-[20px]">
                {/* Icon */}
                <div className="w-[60px] h-[60px] rounded-full bg-[#0F1535] flex items-center justify-center">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FFA412" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                </div>

                {/* Text */}
                <p className="text-white text-[18px] font-bold text-center leading-[1.5]">
                  יש לבחור עסק אחד לפחות במסך דשבורד
                </p>

                {/* Button */}
                <button
                  type="button"
                  onClick={() => setShowBusinessRequiredPopup(false)}
                  className="bg-[#0F1535] text-white text-[14px] font-semibold px-[30px] py-[12px] rounded-[10px] transition-all duration-200 hover:bg-[#1a1f4a] active:scale-[0.98]"
                >
                  חזרה למסך דשבורד
                </button>
              </div>
            </div>
          </>
        )}

        {/* Fixed Header - Always visible, offset by sidebar on desktop */}
        <header role="banner" aria-label="כותרת עליונה" className="fixed top-0 left-0 right-0 lg:right-[220px] z-50 bg-[#0f1231] flex justify-between items-center px-3 sm:px-4 py-3 sm:py-3 min-h-[60px] sm:min-h-[56px]">
          {/* Right side - Menu and Title */}
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              aria-label="תפריט"
              title="תפריט"
              onClick={() => setIsMenuOpen(true)}
              className="w-[44px] h-[44px] sm:w-[40px] sm:h-[40px] flex items-center justify-center text-[#4C526B] cursor-pointer touch-manipulation lg:hidden"
            >
              <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="sm:w-8 sm:h-8">
                <path d="M5 8H27M5 16H27M5 24H27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <span className="text-white text-[17px] sm:text-[19px] font-bold leading-[1.4]">{title}</span>
          </div>

          {/* Left side - Profile, Notifications, Buttons */}
          <div className="flex flex-row-reverse items-stretch gap-2 sm:gap-[5px]">
            {/* Profile Image */}
            <div className="w-[34px] sm:w-[32px] aspect-square rounded-full overflow-hidden border border-[#4C526B] bg-[#29318A] flex items-center justify-center relative touch-manipulation self-center" suppressHydrationWarning>
              {/* Skeleton loader - only show when loading AND there's an image to load */}
              {(isLoadingProfile || (!profileImageLoaded && userProfile?.avatar_url)) && (
                <div className="absolute inset-0 bg-gradient-to-r from-[#29318A] via-[#3D44A0] to-[#29318A] animate-pulse rounded-full" />
              )}
              {userProfile?.avatar_url && (
                <img
                  src={userProfile.avatar_url}
                  alt="Profile"
                  className={`w-full h-full object-cover transition-opacity duration-300 ${profileImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setProfileImageLoaded(true)}
                  onError={() => setProfileImageLoaded(true)}
                />
              )}
              {!isLoadingProfile && !userProfile?.avatar_url && (
                /* User icon when no avatar */
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="sm:w-[18px] sm:h-[18px]">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>

            {/* Notifications with red dot */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="w-[34px] sm:w-[32px] aspect-square self-center rounded-full bg-[#29318A] flex items-center justify-center relative cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="sm:w-[20px] sm:h-[20px] text-[#FFA412]">
                  <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {/* Notification red dot - only show if unread */}
                {unreadCount > 0 && (
                  <div className="absolute top-[5px] right-[8px] w-[10px] h-[10px] bg-[#EB5757] rounded-full"></div>
                )}
              </button>

              {/* Notifications Dropdown - Facebox Style - Full Width */}
              {isNotificationsOpen && (
                <>
                  {/* Overlay to close dropdown */}
                  <div
                    className="fixed inset-0 z-[99]"
                    onClick={() => setIsNotificationsOpen(false)}
                  />
                  {/* Dropdown - Full width */}
                  <div
                    dir="rtl"
                    className="fixed top-[60px] sm:top-[56px] left-0 right-0 lg:right-[220px] w-full lg:w-auto max-h-[70vh] bg-[#111056] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border-b border-white/10 z-[100] overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-[15px] border-b border-white/10">
                      <div className="flex items-center gap-[10px]">
                        <span className="text-white text-[16px] font-bold">התראות</span>
                        {unreadCount > 0 && (
                          <span className="bg-[#EB5757] text-white text-[11px] font-bold px-[8px] py-[2px] rounded-full">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={markAllAsRead}
                          className="text-[12px] text-[#FFA412] hover:text-[#FFB94A] transition-colors"
                        >
                          סמן הכל כנקרא
                        </button>
                      )}
                    </div>

                    {/* Notifications List */}
                    <div className="max-h-[calc(70vh-60px)] overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-[40px] px-[20px]">
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-white/20 mb-[15px]">
                            <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                          <p className="text-white/50 text-[14px]">אין התראות חדשות</p>
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            onClick={() => {
                              if (!notification.is_read) {
                                markNotificationAsRead(notification.id);
                              }
                              if (notification.link) {
                                router.push(notification.link);
                                setIsNotificationsOpen(false);
                              }
                            }}
                            className={`flex gap-[12px] p-[15px] border-b border-white/5 cursor-pointer transition-colors ${
                              notification.is_read
                                ? "bg-transparent hover:bg-white/5"
                                : "bg-[#29318A]/30 hover:bg-[#29318A]/50"
                            }`}
                          >
                            {/* Icon based on type */}
                            <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center flex-shrink-0 ${
                              notification.type === "success" ? "bg-[#3CD856]/20" :
                              notification.type === "warning" ? "bg-[#FFA412]/20" :
                              notification.type === "error" ? "bg-[#EB5757]/20" :
                              "bg-[#29318A]"
                            }`}>
                              {notification.type === "success" ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
                                  <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              ) : notification.type === "warning" ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#FFA412]">
                                  <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              ) : notification.type === "error" ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#EB5757]">
                                  <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#FFA412]">
                                  <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-[10px]">
                                <p className={`text-[14px] font-medium leading-[1.4] ${notification.is_read ? "text-white/70" : "text-white"}`}>
                                  {notification.title}
                                </p>
                                {!notification.is_read && (
                                  <div className="w-[8px] h-[8px] bg-[#FFA412] rounded-full flex-shrink-0 mt-[6px]"></div>
                                )}
                              </div>
                              {notification.message && (
                                <p className="text-[12px] text-white/50 leading-[1.4] mt-[4px] line-clamp-2">
                                  {notification.message}
                                </p>
                              )}
                              <p className="text-[11px] text-white/30 mt-[6px]" suppressHydrationWarning>
                                {formatTimeAgo(notification.created_at)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* AI Button */}
            <Link href="/ai" className="px-[8px] sm:px-[12px] min-w-[50px] sm:min-w-[60px] text-center bg-[#29318A] rounded-[7px] text-white text-[12px] sm:text-[13px] font-bold leading-[1.4] cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation flex items-center justify-center">
              AI
            </Link>

            {/* מרכזת Button - Admin Only */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsCoordinatorModalOpen(true)}
                className="px-[8px] sm:px-[12px] min-w-[50px] sm:min-w-[60px] text-center bg-[#29318A] rounded-[7px] text-white text-[12px] sm:text-[13px] font-bold leading-[1.4] cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation flex items-center justify-center"
              >
                מרכזת
              </button>
            )}
          </div>
        </header>

        {/* Main Content - with top padding for fixed header, right margin for sidebar on desktop */}
        <main role="main" aria-label="תוכן ראשי" className="pt-[60px] sm:pt-[56px] lg:mr-[220px]">
          {children}
        </main>

        {/* Coordinator Modal - Admin Only */}
        {isAdmin && (
          <ConsolidatedInvoiceModal
            isOpen={isCoordinatorModalOpen}
            onClose={() => setIsCoordinatorModalOpen(false)}
          />
        )}
      </div>
    </DashboardContext.Provider>
    <InstallPrompt />
    </ToastProvider>
  );
}
