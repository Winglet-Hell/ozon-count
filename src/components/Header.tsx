import { Upload, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
    onUploadClick?: () => void;
    showUploadButton?: boolean;
}

export function Header({ onUploadClick, showUploadButton }: HeaderProps) {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-sm">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="bg-blue-600 p-1.5 rounded-lg">
                        <Package className="w-5 h-5 text-white" />
                    </div>
                    <h1 className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                        Ozon Report Analyzer
                    </h1>
                </div>

                {showUploadButton && (
                    <button
                        onClick={onUploadClick}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                        <Upload className="w-4 h-4" />
                        <span>Загрузить новый отчет</span>
                    </button>
                )}
            </div>
        </header>
    );
}
