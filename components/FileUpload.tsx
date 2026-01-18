'use client';

import { useCallback, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface FileUploadProps {
  onFileLoaded: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function FileUpload({ onFileLoaded, disabled, compact }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      const ext = file.name.toLowerCase().split('.').pop();
      if (ext !== 'csv' && ext !== 'xlsx') {
        setError('Please upload a CSV or Excel (.xlsx) file');
        return;
      }

      setFileName(file.name);
      onFileLoaded(file);
    },
    [onFileLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  return (
    <Card
      className={`border-2 border-dashed transition-colors ${
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-muted-foreground/50'
      } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <CardContent className={compact ? 'p-4' : 'p-8'}>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className="flex flex-col items-center justify-center text-center"
        >
          {!compact && (
            <svg
              className="w-12 h-12 text-muted-foreground mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          )}

          {fileName ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{fileName}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFileName(null);
                  setError(null);
                }}
              >
                Choose different file
              </Button>
            </div>
          ) : (
            <>
              <p className={`${compact ? 'text-sm' : 'text-lg'} font-medium mb-2`}>
                {compact ? 'Drop file or click to upload' : 'Drop your file with Ethereum addresses here'}
              </p>
              {!compact && (
                <div className="text-sm text-muted-foreground mb-4">
                  <p>We&rsquo;ll find the wallets and do the rest</p>
                  <p className="text-xs mt-1">Supports CSV and Excel (.xlsx)</p>
                </div>
              )}
              <label>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={handleInputChange}
                  className="hidden"
                  disabled={disabled}
                />
                <Button variant="outline" size={compact ? 'sm' : 'default'} asChild>
                  <span>Upload file</span>
                </Button>
              </label>
            </>
          )}

          {error && <p className="text-sm text-destructive mt-4">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
