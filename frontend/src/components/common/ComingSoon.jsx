import React from 'react';
import { Construction } from 'lucide-react';

export default function ComingSoon({ title, description }) {
  return (
    <div className="max-w-2xl mx-auto mt-12 bg-white border border-gray-200 rounded-lg p-8 text-center">
      <Construction className="h-10 w-10 text-amber-500 mx-auto mb-4" />
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      {description && <p className="text-gray-600 mt-2">{description}</p>}
    </div>
  );
}
