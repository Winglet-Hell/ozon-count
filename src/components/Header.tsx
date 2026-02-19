import { Upload, Package, LayoutGrid, Table as TableIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
    onUploadClick?: () => void;
    showUploadButton?: boolean;
    period?: string;
    activeTab: "dashboard" | "articles";
    onTabChange: (tab: "dashboard" | "articles") => void;
}

export function Header({ onUploadClick, showUploadButton, period, activeTab, onTabChange }: HeaderProps) {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-slate-100 bg-white/80 backdrop-blur-md">
            <div className="container mx-auto px-6 h-16 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center">
                        <Package className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="h-4 w-px bg-slate-200 mx-1" />
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
                            Ozon Report
                        </h1>
                        {period && (
                            <span className="text-sm text-slate-500 font-medium">
                                {period}
                            </span>
                        )}
                    </div>
                </div>

                {/* Center Navigation Tabs */}
                {showUploadButton && (
                    <div className="flex-1 hidden md:flex items-center justify-center">
                        <div className="flex items-center p-1 rounded-full bg-slate-100/50 border border-slate-200/50">
                            <button
                                onClick={() => onTabChange("dashboard")}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200",
                                    activeTab === "dashboard"
                                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                                )}
                            >
                                <LayoutGrid className="w-4 h-4" />
                                Dashboard
                            </button>
                            <button
                                onClick={() => onTabChange("articles")}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200",
                                    activeTab === "articles"
                                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                                )}
                            >
                                <TableIcon className="w-4 h-4" />
                                Articles
                            </button>
                        </div>
                    </div>
                )}

                {showUploadButton && (
                    <button
                        onClick={onUploadClick}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-transparent border border-slate-200 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 rounded-lg transition-all"
                    >
                        <Upload className="w-4 h-4" />
                        <span>Upload new report</span>
                    </button>
                )}
            </div>
        </header>
    );
}
