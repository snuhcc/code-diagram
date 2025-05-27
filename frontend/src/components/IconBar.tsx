import {
  FolderIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
interface Props {
  states?: {
    explorer?: boolean;
    search?: boolean;
    diagram?: boolean;
    chat?: boolean;
  };
  toggle?: {
    explorer?: () => void;
    search?: () => void;
    diagram?: () => void;
    chat?: () => void;
  };
}

export default function IconBar({ states = {}, toggle = {} }: Props) {
  const Btn = ({
    on = false,
    click = () => {},
    Icon,
  }: {
    on?: boolean;
    click?: () => void;
    Icon: IconType;
  }) => (
    <button
      onClick={click}
      className={
        'w-10 h-10 flex items-center justify-center transition-colors ' +
        (on ? 'bg-white' : 'hover:bg-slate-100')
      }
    >
      <Icon className={'w-6 ' + (on ? 'stroke-sky-600' : 'stroke-slate-600')} />
    </button>
  );

  return (
    <div className="flex flex-col border-r border-slate-300 bg-slate-200">
      <Btn on={states.explorer} click={toggle.explorer} Icon={FolderIcon} />
      <Btn on={states.search} click={toggle.search} Icon={MagnifyingGlassIcon} />
      <Btn on={states.diagram} click={toggle.diagram} Icon={Squares2X2Icon} />
      <Btn on={states.chat} click={toggle.chat} Icon={ChatBubbleLeftRightIcon} />
    </div>
  );
}