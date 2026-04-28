/**
 * BackChip — context-aware back link.
 *
 * Reads the previous entry from NavStackContext and renders "← {label}".
 * Click navigates to that path so the source page mounts and rehydrates its
 * snapshot via useRestoreSnapshot.
 *
 * Renders nothing when there's no previous entry (e.g., direct deep-link).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useNavStack } from '../../contexts/NavStackContext';

const BackChip = ({ className = '', fallbackLabel = null, fallbackPath = null }) => {
  const navigate = useNavigate();
  const { previous } = useNavStack();

  const target = previous || (fallbackPath ? { path: fallbackPath, label: fallbackLabel } : null);
  if (!target) return null;

  const label = target.label || fallbackLabel || 'Back';

  return (
    <button
      onClick={() => navigate(target.path)}
      className={
        'inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 ' +
        'border border-gray-300 rounded hover:bg-gray-50 hover:text-gray-900 ' +
        className
      }
      title={`Back to ${label}`}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
};

export default BackChip;
