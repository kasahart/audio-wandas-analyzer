"""Check that what the backend thins to draw never becomes a number the app shows (display rules R1, R2, R6, R7).

The backend thins data in a few functions (SOURCES: min/max per bucket, block peaks, resampled cells) and by one
bucket rule (block edges, ``_time_blocks``). What they give is a picture: it may be drawn, indexed, rounded and sent
in a picture's drawn fields (DRAWN_KEYS), and nothing else. This script follows every value they give through the
backend's own code (python-backend, not its tests) and fails where one becomes a number:

- a reduction of drawn points (``np.median``, ``np.max``, ``np.percentile``, ``np.argmax``, ``np.interp``,
  ``sorted``, ``.max()``, …): a median, extreme, range, order, readout or headline of what is drawn;
- a difference of two drawn values (``a - b``, ``np.subtract``): a Δ of drawn points;
- a field of an answer that is not a drawn one (``"minDb"``, ``"peak"``, ``"value"``, …) given drawn points;
- a decision made of drawn points (a comparison) sent, counted or used to pick what is reduced.

Values carry what they are:

- ``D`` drawn: what a decimator gave. Any reduction or Δ of it is a flow.
- ``P`` positions: bucket edges or blocks (the bucket rule). Not values; a value taken at them is a bucket.
- ``B`` bucket: the values of one bucket (``times[block]``). Reducing a bucket is how a picture is thinned (``T``).
- ``T`` thinned: values made of buckets (a block average). Thinning them further along an axis (a band's power
  mean, an interpolated narrow band) still makes the picture; reducing them to one number is a flow.
- ``C`` decided: a comparison of drawn points (``drawn > level``, ``bool(...)``). A mask drawn as the picture's own
  field is drawing; sent in any other field, counted or summed (``np.sum(mask)``, ``any(...)``), or used to pick
  values that are then reduced, it is a number decided by drawn points: a flow.

The analysis follows values through assignments, tuples, containers (a dict's fields one by one), calls into the
backend's own functions (with what each argument carries), ``dataclasses.replace``, attributes set on ``self`` and
module-level stores. A comparison is not a value: it is a decision (``C``), followed as one. Flows the backend has
today are in KNOWN_FLOWS, each with its gap in the contract table (src/test/plotContracts): the list only shrinks.
A flow not listed fails, and so does a listed one no longer found.

The contract table's backend readers classified 'draws' (DRAWN_READERS in values.ts) are checked too: what each
returns of drawn points carries its name wherever it goes, and the reader fails if its own code, or any code its
result reaches, makes a flow of it (another field, a reduction, a decision): drawing is only putting it in a picture.

Run: ``python scripts/check_decimation_flow.py`` (exit 1 on a problem); ``--list`` prints every flow found.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "python-backend"
VALUES_TS = ROOT / "src" / "test" / "plotContracts" / "values.ts"

WHOLE = "*"
#: The source of a 'draws' reader's result in a flow (``draws=module:function``).
TAG = "draws="
DRAWN, POSITIONS, BUCKET, THINNED, DECIDED = "D", "P", "B", "T", "C"

#: The backend's functions that thin data to draw it: what kind their result is and which of its fields are thinned
#: (WHOLE: all of it). Every one but the bucket rule's (BUCKET_RULE) is the contract table's PY_DECIMATORS too.
SOURCES: dict[str, tuple[str, frozenset[str]]] = {
    "decimator:decimated_waveform": (DRAWN, frozenset({"min", "max", "minT", "maxT", "samples"})),
    "decimator:bucket_starts": (POSITIONS, frozenset({WHOLE})),
    "decimator:bucket_edges": (POSITIONS, frozenset({WHOLE})),
    **{
        f"stage_view:{name}": (DRAWN, frozenset({WHOLE}))
        for name in (
            "min_max_indices",
            "min_max_line",
            "min_max_rows",
            "spectrum_line",
            "_block_peaks",
            "_signed_peaks",
            "_envelope",
            "_cepstrum_envelope",
        )
    },
    "stage_view:_time_blocks": (POSITIONS, frozenset({WHOLE})),
    "stage_view:samples_waveform": (DRAWN, frozenset({"min", "max", "minT", "maxT"})),
    **{
        f"analyzer:{name}": (DRAWN, frozenset({WHOLE}))
        for name in ("resample_frequency_bins", "_resample_time_bins", "min_max_spectrum")
    },
    # A scan's 192-point spectrum: every Welch bin power-averaged into log-spaced points, to draw.
    "scan_service:log_spectrum": (DRAWN, frozenset({WHOLE})),
}
#: The bucket rule's own functions (decimator.py): positions only, which the contract table does not list.
BUCKET_RULE = frozenset({"decimator:bucket_starts", "decimator:bucket_edges"})

#: The fields of a picture that carry its drawn points: a drawn value may go here, and only here.
DRAWN_KEYS = frozenset(
    {
        # StageView and its waveform (stage_view.py, stage_combine.py)
        "xs",
        "ys",
        "values",
        "matrix",
        "waveform",
        "events",
        "min",
        "max",
        "minT",
        "maxT",
        "samples",
        # The cursor spectrum's slice and the lanes' spectrogram (analysis_service.py, analyzer.py)
        "frequenciesHz",
        "timeCentersSec",
        # A scan's 192-point spectrum (scan_service.py)
        "spectrumDb",
    }
)

#: Reductions: a number made of the values given (a median, an extreme, a range, an order, a sum, a readout).
REDUCERS = frozenset(
    {
        *("median", "nanmedian", "mean", "nanmean", "average", "max", "min", "amax", "amin", "nanmax", "nanmin"),
        *("argmax", "argmin", "nanargmax", "nanargmin", "percentile", "nanpercentile", "quantile", "nanquantile"),
        *("ptp", "std", "nanstd", "var", "nanvar", "sum", "nansum", "sort", "argsort", "lexsort", "partition"),
        *("argpartition", "dot", "cumsum", "interp", "bincount", "histogram"),
    }
)
#: Reductions whose second positional argument is the axis.
AXIS_SECOND = REDUCERS - {
    *("percentile", "nanpercentile", "quantile", "nanquantile", "dot", "interp", "lexsort", "bincount", "histogram")
}
#: Reductions along an axis by nature (a value per x, not one number).
ALONG_AXIS = frozenset({"interp"})
BUILTIN_REDUCERS = frozenset({"max", "min", "sorted", "sum"})
#: NumPy calls that arrange, convert, round or test values without computing a number of them: drawn points given
#: to these are still drawn (the picture's own form), not a reader's computation.
ARRANGING = frozenset(
    {
        *("asarray", "array", "stack", "vstack", "hstack", "concatenate", "round", "nan_to_num", "take_along_axis"),
        *("reshape", "isfinite", "isnan", "copy", "full_like", "zeros_like", "ascontiguousarray", "where", "unique"),
    }
)
#: Attributes of an array that are not its values.
SHAPE_ATTRIBUTES = frozenset({"size", "shape", "ndim", "dtype", "nbytes", "itemsize"})
#: Methods that put their argument into their receiver (a list, a cache, a store), by how their names start.
STORING_METHODS = ("append", "extend", "insert", "add", "put", "set", "store", "cache", "remember", "__setitem__")
#: Calls whose result carries nothing of their arguments' values.
CLEAN_BUILTINS = frozenset({"len", "isinstance", "callable", "type", "id", "hash", "range", "str", "repr", "getattr"})

#: Flows the backend has today, by ``module:function: what``, with the contract table's gap that holds each (or, for
#: a number the app does not show, why). Fix the flow and remove its line; never add one to let a new flow through.
KNOWN_FLOWS: dict[str, str] = {}

Pair = tuple[str, str]  # (field, origin): origin is "source|kind"; a parameter's source is "@index:kind"
Taint = frozenset[Pair]
CLEAN: Taint = frozenset()


def kind_of(origin: str) -> str:
    return origin[-1]


def source_of(origin: str) -> str:
    return origin[:-2]


def with_kind(origin: str, kind: str) -> str:
    return f"{origin[:-1]}{kind}"


def flat(taint: Taint) -> Taint:
    """``taint`` as one value: every origin, as the whole."""
    return frozenset((WHOLE, origin) for _, origin in taint)


def rekind(taint: Taint, change: Callable[[str], str]) -> Taint:
    return frozenset((name, with_kind(origin, change(kind_of(origin)))) for name, origin in taint)


#: How deep a container's fields are told apart (``channels.values``); deeper, the field stands for all inside it.
DEPTH = 4


def nest(key: str, name: str) -> str:
    """The field ``name`` of a value put under ``key``."""
    path = key if name == WHOLE else f"{key}.{name}"
    return ".".join(path.split(".")[:DEPTH])


def nested(taint: Taint, key: object) -> Taint:
    """``taint`` put under the field ``key`` of a container (a dict's key, a tuple's ``#index``)."""
    if not isinstance(key, str):
        return flat(taint)
    return frozenset((nest(key, name), origin) for name, origin in taint)


def element(taint: Taint, key: object) -> Taint:
    """What ``value[key]`` (or ``value.key``) carries: a field by name, a tuple's item by position, else the value."""
    if isinstance(key, int):
        key = f"#{key}"
    out: set[Pair] = set()
    for name, origin in taint:
        head, _, rest = name.partition(".")
        if name == WHOLE:
            out.add((WHOLE, origin))
        elif isinstance(key, str):
            if head == key:
                out.add((rest or WHOLE, origin))
            elif not key.startswith("#") and head.startswith("#"):
                continue
            elif key.startswith("#") and not head.startswith("#"):
                out.add((name, origin))  # an item of a list keeps its fields
        elif head.startswith("#"):
            out.add((rest or WHOLE, origin))
        else:
            out.add((name, origin))
    return frozenset(out)


def bare(taint: Taint) -> Taint:
    """The pairs that are the value itself (or a tuple's item), not a field of a container in it."""
    return frozenset(pair for pair in taint if pair[0] == WHOLE or re.fullmatch(r"#\d+", pair[0]))


def decided(taint: Taint) -> Taint:
    """A comparison (or a truth) of ``taint``: a decision made of its drawn points, as one value."""
    return frozenset((WHOLE, with_kind(origin, DECIDED)) for _, origin in taint if kind_of(origin) in (DRAWN, DECIDED))


def decisions_of(taint: Taint) -> Taint:
    """The pairs that are decisions made of drawn points."""
    return frozenset(pair for pair in taint if kind_of(pair[1]) == DECIDED)


def values_of(taint: Taint) -> Taint:
    """The pairs that are values (drawn or thinned), not positions or buckets."""
    return frozenset(pair for pair in taint if kind_of(pair[1]) in (DRAWN, THINNED))


@dataclass(frozen=True)
class Flow:
    """A drawn value made a number: where (``module:function``), what, and the decimators it came from."""

    where: str
    line: int
    what: str
    origins: frozenset[str]
    path: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.where}: {self.what}"

    @property
    def sources(self) -> list[str]:
        return sorted({source_of(origin) for origin in self.origins if not source_of(origin).startswith(TAG)})

    @property
    def tags(self) -> list[str]:
        """The 'draws' readers (``module:function``) whose result this flow is made of."""
        return sorted({source_of(origin)[len(TAG) :] for origin in self.origins if source_of(origin).startswith(TAG)})


@dataclass
class Function:
    name: str  # module:Qual.name
    module: str
    node: ast.FunctionDef | ast.AsyncFunctionDef
    cls: str | None
    params: list[str]


@dataclass
class Module:
    name: str
    tree: ast.Module
    aliases: dict[str, str] = field(default_factory=dict)  # local name -> module
    imported: dict[str, str] = field(default_factory=dict)  # local name -> module:function
    globals: set[str] = field(default_factory=set)


def _short(node: ast.AST) -> str:
    text = ast.unparse(node)
    return text if len(text) <= 80 else text[:77] + "..."


Context = tuple[frozenset[tuple[str, str]], ...]  # per parameter: (field, kind) it carries


@dataclass(frozen=True)
class Summary:
    """What a function does given its parameters' context: what it returns, the flows in it, and what it puts in
    stores of what its parameters carry (for the caller to put its own origins in)."""

    returned: Taint
    flows: list[Flow]
    stores: list[tuple[str, Taint]]


EMPTY = Summary(frozenset(), [], [])


class Program:
    """The backend's modules, functions and what flows between them."""

    def __init__(self, sources: dict[str, str], tagged: Iterable[str] = ()) -> None:
        #: The 'draws' readers (``module:function``): what each returns of drawn points also carries its name.
        self.tagged = frozenset(tagged)
        self.modules = {name: Module(name, ast.parse(text)) for name, text in sorted(sources.items())}
        self.functions: dict[str, Function] = {}
        #: The backend's classes (dataclasses, NamedTuples, TypedDicts) by ``module:Class``: their fields in order.
        self.classes: dict[str, list[str]] = {}
        for module in self.modules.values():
            self._index(module)
        self.memo: dict[tuple[str, Context], Summary] = {}
        self.active: set[tuple[str, Context]] = set()
        #: Values kept on an object or a module-level store, by ``module:Class.attr`` / ``module:NAME``.
        self.stores: dict[str, Taint] = {}
        self.stores_changed = False
        #: The functions whose own code computes with drawn, thinned or decided points (arithmetic, a comparison, a
        #: reduction, a numeric call), by ``module:function``: with the decimators those points came from.
        self.readers: dict[str, set[str]] = {}

    def _index(self, module: Module) -> None:
        for node in ast.walk(module.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in self.modules:
                        module.aliases[alias.asname or alias.name] = alias.name
            elif isinstance(node, ast.ImportFrom) and node.module in self.modules and node.level == 0:
                for alias in node.names:
                    module.imported[alias.asname or alias.name] = f"{node.module}:{alias.name}"
        for node in module.tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._add(module.name, node, None)
            elif isinstance(node, ast.ClassDef):
                self.classes[f"{module.name}:{node.name}"] = [
                    item.target.id
                    for item in node.body
                    if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)
                ]
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        self._add(module.name, item, node.name)
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                module.globals.update(target.id for target in targets if isinstance(target, ast.Name))

    def _add(self, module: str, node: ast.FunctionDef | ast.AsyncFunctionDef, cls: str | None) -> None:
        qual = f"{cls}.{node.name}" if cls else node.name
        args = node.args
        params = [a.arg for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]]
        self.functions[f"{module}:{qual}"] = Function(f"{module}:{qual}", module, node, cls, params)

    def resolve(self, module: str, cls: str | None, func: ast.expr) -> str | None:
        """The backend function a call names, if it is one."""
        mod = self.modules[module]
        if isinstance(func, ast.Name):
            here = f"{module}:{func.id}"
            if here in self.functions or here in SOURCES or here in self.classes:
                return here
            return mod.imported.get(func.id)
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            if func.value.id in mod.aliases:
                return f"{mod.aliases[func.value.id]}:{func.attr}"
            if func.value.id in ("self", "cls") and cls and f"{module}:{cls}.{func.attr}" in self.functions:
                return f"{module}:{cls}.{func.attr}"
        return None

    def analyse(self, name: str, context: Context) -> Summary:
        """What ``name`` returns and the flows inside it when its parameters carry ``context`` (as origins
        ``@index:kind``, for the caller to put its own in)."""
        key = (name, context)
        if key in self.memo:
            return self.memo[key]
        if key in self.active or len(self.active) > 40:
            return EMPTY
        self.active.add(key)
        try:
            function = self.functions[name]
            walker = Walker(self, function)
            for index, (param, carried) in enumerate(zip(function.params, context, strict=False)):
                walker.env[param] = frozenset((f, f"@{index}:{k}|{k}") for f, k in carried)
            walker.block(function.node.body)
            result = Summary(walker.returned, walker.flows, walker.pending)
        finally:
            self.active.discard(key)
        self.memo[key] = result
        return result

    def store(self, where: str, taint: Taint) -> None:
        if taint and not taint <= self.stores.get(where, CLEAN):
            self.stores[where] = self.stores.get(where, CLEAN) | taint
            self.stores_changed = True

    def run(self) -> list[Flow]:
        """Every flow, from every function analysed as an entry (its parameters carrying nothing drawn), until what
        the stores hold settles."""
        for _ in range(10):
            self.stores_changed = False
            self.memo.clear()
            flows: dict[tuple[str, int, str], Flow] = {}
            for name, function in self.functions.items():
                if name in SOURCES:
                    continue
                for flow in self.analyse(name, tuple(frozenset() for _ in function.params)).flows:
                    known = flows.get((flow.where, flow.line, flow.what))
                    if known is None:
                        flows[(flow.where, flow.line, flow.what)] = flow
                    else:
                        flows[(flow.where, flow.line, flow.what)] = Flow(
                            known.where, known.line, known.what, known.origins | flow.origins, known.path or flow.path
                        )
            if not self.stores_changed:
                return sorted(flows.values(), key=lambda flow: (flow.where, flow.line, flow.what))
        raise RuntimeError("check_decimation_flow: what the stores hold did not settle")


class Walker:
    """One function's body, followed statement by statement."""

    def __init__(self, program: Program, function: Function) -> None:
        self.program = program
        self.function = function
        self.module = function.module
        self.env: dict[str, Taint] = {}
        self.local_defs: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {}
        self.inside: set[str] = set()
        #: Names bound to a literal of field names (``same = ("kind", "x")``) and the loop names over one
        #: (``for key in same``): ``view.get(key)`` is those fields, not the whole view.
        self.names: dict[str, tuple[str, ...]] = {}
        self.returned: Taint = CLEAN
        self.flows: list[Flow] = []
        #: What this function puts in a store of its parameters' values, for its caller to store as its own.
        self.pending: list[tuple[str, Taint]] = []

    def store(self, where: str, taint: Taint) -> None:
        self.program.store(where, frozenset(pair for pair in taint if not pair[1].startswith("@")))
        mine = frozenset(pair for pair in taint if pair[1].startswith("@"))
        if mine:
            self.pending.append((where, mine))

    def computes(self, taint: Taint, node: ast.AST | None = None) -> None:
        """This function's own code computes with ``taint``: a reader of drawn points, if any are in it."""
        used = frozenset(origin for _, origin in taint if kind_of(origin) in (DRAWN, THINNED, DECIDED))
        if used:
            given = {source_of(origin) for origin in used if not origin.startswith(("@", TAG))}
            self.program.readers.setdefault(self.function.name, set()).update(given or {"(its caller's)"})

    def flow(self, node: ast.AST, what: str, taint: Taint) -> None:
        self.flows.append(Flow(self.function.name, getattr(node, "lineno", 0), what, frozenset(o for _, o in taint)))

    # --- statements --------------------------------------------------------------------------------------

    def block(self, body: Iterable[ast.stmt]) -> None:
        for statement in body:
            self.statement(statement)

    def branches(self, *bodies: list[ast.stmt]) -> None:
        start = dict(self.env)
        merged: dict[str, Taint] = {}
        for body in bodies:
            self.env = dict(start)
            self.block(body)
            for name, taint in self.env.items():
                merged[name] = merged.get(name, CLEAN) | taint
        self.env = merged

    def loop(self, body: list[ast.stmt], bind: ast.expr | None = None, taint: Taint = CLEAN) -> None:
        for _ in range(3):
            before = dict(self.env)
            if bind is not None:
                names = self.names.get(bind.id) if isinstance(bind, ast.Name) else None
                self.assign(bind, taint, None)
                if names is not None and isinstance(bind, ast.Name):
                    self.names[bind.id] = names
            self.branches(body, [])
            if self.env == before:
                break

    def statement(self, node: ast.stmt) -> None:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.local_defs[node.name] = node
            self.env.pop(node.name, None)
        elif isinstance(node, ast.Assign):
            value = self.expr(node.value)
            for target in node.targets:
                self.assign(target, value, node.value)
        elif isinstance(node, ast.AnnAssign):
            if node.value is not None:
                self.assign(node.target, self.expr(node.value), node.value)
        elif isinstance(node, ast.AugAssign):
            value, current = self.expr(node.value), self.expr(node.target)
            if isinstance(node.op, ast.Sub):
                self.difference(node, current, value)
            self.assign(node.target, flat(current | value), None)
        elif isinstance(node, ast.Return):
            if node.value is not None:
                self.returned |= self.expr(node.value)
        elif isinstance(node, ast.Expr):
            self.expr(node.value)
        elif isinstance(node, ast.If):
            self.expr(node.test)
            self.branches(node.body, node.orelse)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            self.key_of(node.target, node.iter)
            self.loop(node.body, node.target, self.expr(node.iter))
            self.block(node.orelse)
        elif isinstance(node, ast.While):
            self.expr(node.test)
            self.loop(node.body)
            self.block(node.orelse)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                value = self.expr(item.context_expr)
                if item.optional_vars is not None:
                    self.assign(item.optional_vars, value, None)
            self.block(node.body)
        elif isinstance(node, ast.Try):
            self.block(node.body)
            self.branches(*[handler.body for handler in node.handlers], node.orelse, [])
            self.block(node.finalbody)
        elif isinstance(node, ast.Match):
            self.expr(node.subject)
            self.branches(*[case.body for case in node.cases], [])
        elif isinstance(node, (ast.Raise, ast.Assert, ast.Delete)):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.expr):
                    self.expr(child)

    def field_names(self, node: ast.expr | None) -> tuple[str, ...] | None:
        """The field names ``node`` is a literal of (or a name bound to one), if it is."""
        if isinstance(node, ast.Name):
            return self.names.get(node.id)
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)) and node.elts:
            items = [self.constant(item) for item in node.elts]
            if all(isinstance(item, str) for item in items):
                return tuple(str(item) for item in items)
        return None

    def key_of(self, target: ast.expr, iterated: ast.expr) -> None:
        """``target`` bound by a loop over ``iterated``: each of its field names, if it is a literal of them."""
        names = self.field_names(iterated)
        if isinstance(target, ast.Name):
            if names is not None:
                self.names[target.id] = names
            else:
                self.names.pop(target.id, None)

    def element_at(self, taint: Taint, key: ast.expr) -> Taint:
        """``value[key]``: a field by a constant name, or each field a loop name takes."""
        names = self.names.get(key.id) if isinstance(key, ast.Name) else None
        if names is None:
            return element(taint, self.constant(key))
        out: Taint = CLEAN
        for name in names:
            out |= element(taint, name)
        return out

    def assign(self, target: ast.expr, taint: Taint, value: ast.expr | None) -> None:
        if isinstance(target, ast.Name):
            self.env[target.id] = taint
            names = self.field_names(value) if value is not None and not isinstance(value, ast.Name) else None
            if names is not None:
                self.names[target.id] = names
            else:
                self.names.pop(target.id, None)
        elif isinstance(target, (ast.Tuple, ast.List)):
            same = isinstance(value, (ast.Tuple, ast.List)) and len(value.elts) == len(target.elts)
            for index, item in enumerate(target.elts):
                if isinstance(item, ast.Starred):
                    self.assign(item.value, element(taint, None), None)
                elif same:
                    part = value.elts[index]  # type: ignore[union-attr]
                    self.assign(item, self.expr(part), part)
                else:
                    self.assign(item, element(taint, index), None)
        elif isinstance(target, ast.Subscript):
            key = self.constant(target.slice)
            self.expr(target.slice)
            if not self.is_store(target.value):
                self.check_field(target, key, taint)
            self.put(target.value, nested(taint, key))
        elif isinstance(target, ast.Attribute):
            self.put(target, flat(taint))
        elif isinstance(target, ast.Starred):
            self.assign(target.value, taint, None)

    def put(self, target: ast.expr, taint: Taint) -> None:
        """``taint`` added to what ``target`` holds (a container a value was put into)."""
        if not taint:
            return
        if isinstance(target, ast.Name):
            store = self.store_of(target.id)
            if store is not None:
                self.store(store, taint)
            else:
                self.env[target.id] = self.env.get(target.id, CLEAN) | taint
        elif isinstance(target, ast.Attribute):
            if isinstance(target.value, ast.Name) and target.value.id == "self" and self.function.cls:
                self.store(f"{self.module}:{self.function.cls}.{target.attr}", taint)
            else:
                self.put(target.value, nested(taint, target.attr))
        elif isinstance(target, ast.Subscript):
            self.put(target.value, flat(taint))

    def store_of(self, name: str) -> str | None:
        """The module-level store a name is here (this module's global, or one imported from another), if it is one."""
        if name in self.env:
            return None
        module = self.program.modules[self.module]
        if name in module.globals:
            return f"{self.module}:{name}"
        imported = module.imported.get(name)
        if imported is not None and imported.split(":")[1] in self.program.modules[imported.split(":")[0]].globals:
            return imported
        return None

    def is_store(self, node: ast.expr) -> bool:
        """Whether ``node`` is a store (a module-level one, or an attribute of ``self``) rather than an answer."""
        if isinstance(node, ast.Name):
            return self.store_of(node.id) is not None
        return isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self"

    def check_field(self, node: ast.AST, key: object, taint: Taint) -> None:
        """A drawn value itself (not a picture holding drawn fields) put under a field that is not a drawn one."""
        drawn = bare(values_of(taint))
        if isinstance(key, str) and key not in DRAWN_KEYS and drawn:
            self.flow(node, f"field {key!r} = drawn points", drawn)
        decided = bare(decisions_of(taint))
        if isinstance(key, str) and key not in DRAWN_KEYS and decided:
            self.flow(node, f"field {key!r} = decided by drawn points", decided)

    def reduction(self, node: ast.Call, what: str, taint: Taint, along_axis: bool) -> Taint:
        """A reduction of ``taint``: a flow if it reduces drawn points, or thinned ones to one number."""
        self.computes(taint, node)
        flowing = frozenset(
            pair
            for pair in taint
            if kind_of(pair[1]) in (DRAWN, DECIDED) or (kind_of(pair[1]) == THINNED and not along_axis)
        )
        if flowing:
            self.flow(node, what, flowing)
        return flat(rekind(taint, lambda kind: THINNED if kind == BUCKET else kind))

    def difference(self, node: ast.AST, left: Taint, right: Taint) -> None:
        if values_of(left) and values_of(right):
            self.flow(node, f"Δ {_short(node)}", values_of(left) | values_of(right))

    @staticmethod
    def constant(node: ast.expr) -> object:
        return node.value if isinstance(node, ast.Constant) else None

    # --- expressions -------------------------------------------------------------------------------------

    def expr(self, node: ast.expr | None) -> Taint:
        if node is None:
            return CLEAN
        method = getattr(self, f"_{type(node).__name__}", None)
        if method is not None:
            return method(node)
        taint = CLEAN
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.expr):
                taint |= flat(self.expr(child))
        return taint

    def _Constant(self, node: ast.Constant) -> Taint:
        return CLEAN

    def _Lambda(self, node: ast.Lambda) -> Taint:
        return CLEAN

    def _Compare(self, node: ast.Compare) -> Taint:
        # Not a value but a decision: of drawn points, it is followed as one (C) to where it is sent or counted. A
        # presence test (``is None``, ``in``, ``== []``) says only whether there is anything: no decision of values.
        taint = self.expr(node.left)
        for comparator in node.comparators:
            taint |= self.expr(comparator)
        presence = all(isinstance(op, (ast.Is, ast.IsNot, ast.In, ast.NotIn)) for op in node.ops) or any(
            isinstance(side, (ast.Constant, ast.List, ast.Tuple, ast.Dict))
            and not getattr(side, "elts", None)
            and not isinstance(getattr(side, "value", None), (int, float))
            for side in [node.left, *node.comparators]
        )
        if presence:
            return CLEAN
        self.computes(taint, node)
        return decided(taint)

    def _UnaryOp(self, node: ast.UnaryOp) -> Taint:
        taint = self.expr(node.operand)
        return CLEAN if isinstance(node.op, ast.Not) else taint

    def _JoinedStr(self, node: ast.JoinedStr) -> Taint:
        for child in ast.walk(node):
            if isinstance(child, ast.FormattedValue):
                self.expr(child.value)
        return CLEAN

    def _Name(self, node: ast.Name) -> Taint:
        if node.id in self.env:
            return self.env[node.id]
        store = self.store_of(node.id)
        return self.program.stores.get(store, CLEAN) if store else CLEAN

    def _Attribute(self, node: ast.Attribute) -> Taint:
        if node.attr in SHAPE_ATTRIBUTES:
            self.expr(node.value)
            return CLEAN
        if isinstance(node.value, ast.Name) and node.value.id == "self" and self.function.cls:
            return self.program.stores.get(f"{self.module}:{self.function.cls}.{node.attr}", CLEAN)
        return element(self.expr(node.value), node.attr)

    def _Subscript(self, node: ast.Subscript) -> Taint:
        value = self.element_at(self.expr(node.value), node.slice)
        index = self.expr(node.slice)
        # Values taken at a bucket's positions are that bucket; at drawn points' indices, drawn points.
        return value | flat(rekind(index, lambda kind: BUCKET if kind == POSITIONS else kind))

    def _Tuple(self, node: ast.Tuple) -> Taint:
        taint = CLEAN
        for index, item in enumerate(node.elts):
            taint |= nested(self.expr(item), f"#{index}")
        return taint

    def _List(self, node: ast.List | ast.Set) -> Taint:
        taint = CLEAN
        for item in node.elts:
            taint |= self.expr(item)
        return taint

    _Set = _List

    def _Dict(self, node: ast.Dict) -> Taint:
        taint = CLEAN
        for key, value in zip(node.keys, node.values, strict=True):
            carried = self.expr(value)
            if key is None:
                taint |= carried
                continue
            name = self.constant(key)
            self.expr(key)
            self.check_field(value, name, carried)
            taint |= nested(carried, name)
        return taint

    def _BinOp(self, node: ast.BinOp) -> Taint:
        left, right = self.expr(node.left), self.expr(node.right)
        self.computes(left | right, node)
        if isinstance(node.op, ast.Sub):
            self.difference(node, left, right)
        return flat(left | right)

    def _IfExp(self, node: ast.IfExp) -> Taint:
        self.expr(node.test)
        return self.expr(node.body) | self.expr(node.orelse)

    def _NamedExpr(self, node: ast.NamedExpr) -> Taint:
        taint = self.expr(node.value)
        self.assign(node.target, taint, node.value)
        return taint

    def _Starred(self, node: ast.Starred) -> Taint:
        return self.expr(node.value)

    def comprehension(self, generators: list[ast.comprehension]) -> dict[str, Taint]:
        saved = dict(self.env)
        for generator in generators:
            self.assign(generator.target, self.expr(generator.iter), None)
            self.key_of(generator.target, generator.iter)
            for condition in generator.ifs:
                self.expr(condition)
        return saved

    def _ListComp(self, node: ast.ListComp | ast.SetComp | ast.GeneratorExp) -> Taint:
        saved = self.comprehension(node.generators)
        taint = self.expr(node.elt)
        self.env = saved
        return taint

    _SetComp = _ListComp
    _GeneratorExp = _ListComp

    def _DictComp(self, node: ast.DictComp) -> Taint:
        copied = self.copied_fields(node)
        if copied is not None:
            return copied
        saved = self.comprehension(node.generators)
        self.expr(node.key)
        # Its keys are not known here: each value keeps its fields, read back by a key that is not known either.
        taint = self.expr(node.value)
        self.env = saved
        return taint

    def copied_fields(self, node: ast.DictComp) -> Taint | None:
        """``{k: v for k, v in d.items() if k not in (...)}``: ``d``'s fields, but those left out."""
        if len(node.generators) != 1:
            return None
        generator = node.generators[0]
        target, source = generator.target, generator.iter
        if not (
            isinstance(target, ast.Tuple)
            and len(target.elts) == 2
            and isinstance(source, ast.Call)
            and isinstance(source.func, ast.Attribute)
            and source.func.attr == "items"
            and isinstance(node.key, ast.Name)
            and isinstance(node.value, ast.Name)
            and [node.key.id, node.value.id] == [getattr(item, "id", None) for item in target.elts]
        ):
            return None
        left_out: set[str] = set()
        for condition in generator.ifs:
            if (
                isinstance(condition, ast.Compare)
                and isinstance(condition.ops[0], ast.NotIn)
                and isinstance(condition.left, ast.Name)
                and condition.left.id == node.key.id
                and isinstance(condition.comparators[0], (ast.Tuple, ast.List, ast.Set))
            ):
                left_out.update(str(self.constant(item)) for item in condition.comparators[0].elts)
            else:
                self.expr(condition)
        return frozenset(pair for pair in self.expr(source.func.value) if pair[0] not in left_out)

    @staticmethod
    def along_axis(node: ast.Call, name: str) -> bool:
        return (
            name in ALONG_AXIS
            or any(keyword.arg == "axis" for keyword in node.keywords)
            or (name in AXIS_SECOND and len(node.args) >= 2)
        )

    def _Call(self, node: ast.Call) -> Taint:
        func = node.func
        args = [self.expr(arg) for arg in node.args]
        keywords = {keyword.arg: self.expr(keyword.value) for keyword in node.keywords}
        every = CLEAN
        for taint in [*args, *keywords.values()]:
            every |= taint
        target = self.program.resolve(self.module, self.function.cls, func)
        if target in SOURCES:
            kind, fields = SOURCES[target]
            return frozenset((name, f"{target}|{kind}") for name in fields)
        if target is not None and target in self.program.classes:
            # A record of the backend's: each argument is the field it is given as.
            names = self.program.classes[target]
            made = CLEAN
            for index, taint in enumerate(args):
                made |= nested(taint, names[index]) if index < len(names) else flat(taint)
            for key, taint in keywords.items():
                made |= nested(taint, key) if key else taint
            return made
        if target is not None and target in self.program.functions:
            return self.call(node, target, args, keywords, method=isinstance(func, ast.Attribute))
        if isinstance(func, ast.Name):
            return self.builtin(node, func.id, args, keywords, every)
        if isinstance(func, ast.Attribute):
            return self.method(node, func, args, keywords, every)
        return flat(self.expr(func) | every)

    def builtin(
        self, node: ast.Call, name: str, args: list[Taint], keywords: dict[str | None, Taint], every: Taint
    ) -> Taint:
        if name in self.local_defs:
            return self.local_call(name, args, keywords)
        if name in BUILTIN_REDUCERS:
            return self.reduction(node, f"{name}({', '.join(_short(a) for a in node.args)})", every, False)
        if name in ("bool", "all", "any"):
            # A truth of drawn points: a decision, followed to where it is sent or counted (a branch on it is not).
            return decided(every)
        if name in CLEAN_BUILTINS:
            return CLEAN
        if name == "enumerate" and args:
            return nested(args[0], "#1")
        if name == "zip":
            taint = CLEAN
            for index, arg in enumerate(args):
                taint |= nested(arg, f"#{index}")
            return taint
        if name in ("replace", "dict") and args:
            # dataclasses.replace(obj, field=value), dict(mapping, key=value): the fields as given.
            taint = args[0]
            for key, carried in keywords.items():
                taint |= nested(carried, key) if key else carried
            return taint
        return flat(every)

    def method(
        self,
        node: ast.Call,
        func: ast.Attribute,
        args: list[Taint],
        keywords: dict[str | None, Taint],
        every: Taint,
    ) -> Taint:
        name = func.attr
        if self.is_numpy(func.value):
            if name in REDUCERS:
                what = f"np.{name}({', '.join(_short(a) for a in node.args)})"
                return self.reduction(node, what, every, self.along_axis(node, name))
            if name == "subtract" and len(args) >= 2:
                self.difference(node, args[0], args[1])
            if name not in ARRANGING:
                self.computes(every, node)
            return flat(every)
        receiver = self.expr(func.value)
        if name in REDUCERS:
            what = f"{_short(func.value)}.{name}()"
            return self.reduction(node, what, receiver, self.along_axis(node, name) or bool(node.args)) | flat(every)
        if name == "get" and node.args:
            return self.element_at(receiver, node.args[0]) | (args[1] if len(args) > 1 else CLEAN)
        if name == "update":
            stored = CLEAN
            for taint in args:
                stored |= taint
            for key, taint in keywords.items():
                if key is not None:
                    self.check_field(node, key, taint)
                stored |= nested(taint, key) if key else taint
            self.put(func.value, stored)
            return CLEAN
        if name.startswith(STORING_METHODS):
            if name == "__setitem__" and len(node.args) == 2:
                self.check_field(node, self.constant(node.args[0]), args[1])
            self.put(func.value, every)
            return CLEAN
        if name in ("copy", "values"):
            return receiver
        if name == "items":
            return nested(receiver, "#1")
        if name == "keys":
            return CLEAN
        return flat(receiver | every)

    @staticmethod
    def is_numpy(node: ast.expr) -> bool:
        while isinstance(node, ast.Attribute):
            node = node.value
        return isinstance(node, ast.Name) and node.id in ("np", "numpy")

    def call(
        self, node: ast.Call, target: str, args: list[Taint], keywords: dict[str | None, Taint], method: bool
    ) -> Taint:
        """A call of a backend function: followed into it with what each argument carries."""
        function = self.program.functions[target]
        offset = 1 if method and function.params[:1] in (["self"], ["cls"]) else 0
        bound: list[Taint] = [CLEAN] * len(function.params)
        spill = CLEAN
        for index, (arg, taint) in enumerate(zip(node.args, args, strict=True)):
            if isinstance(arg, ast.Starred) or offset + index >= len(function.params):
                spill |= flat(taint)
            else:
                bound[offset + index] = taint
        for name, taint in keywords.items():
            if name in function.params:
                bound[function.params.index(name)] |= taint
            else:
                spill |= flat(taint)
        if spill:
            bound = [taint | spill for taint in bound]
        context = tuple(frozenset((f, kind_of(o)) for f, o in taint) for taint in bound)
        summary = self.program.analyse(target, context)

        def callers(origin: str) -> list[Pair]:
            """The caller's pairs a callee's parameter origin ``@index:kind|…`` stands for."""
            index, kind = origin[1:-2].split(":")
            return [pair for pair in bound[int(index)] if kind_of(pair[1]) == kind]

        def own(taint: Taint) -> Taint:
            """``taint`` of the callee with this call's origins for its parameters' (the callee followed their
            fields itself: a pair's field is already where they went)."""
            out: set[Pair] = set()
            for name, origin in taint:
                if origin.startswith("@"):
                    out.update((name, with_kind(caller, kind_of(origin))) for _, caller in callers(origin))
                else:
                    out.add((name, origin))
            return frozenset(out)

        for flow in summary.flows:
            real = frozenset(origin for _, origin in own(frozenset((WHOLE, origin) for origin in flow.origins)))
            if real:
                path = (*flow.path, f"{self.function.name}:{node.lineno}")
                self.flows.append(Flow(flow.where, flow.line, flow.what, real, path))
        for where, taint in summary.stores:
            self.store(where, own(taint))
        returned = own(summary.returned)
        if target in self.program.tagged:
            # A 'draws' reader's result of drawn points: followed as its own, to every field it reaches.
            returned |= frozenset(
                (name, f"{TAG}{target}|{kind_of(origin)}")
                for name, origin in returned
                if kind_of(origin) in (DRAWN, THINNED, DECIDED)
            )
        return returned

    def local_call(self, name: str, args: list[Taint], keywords: dict[str | None, Taint]) -> Taint:
        """A def inside this function: its body followed here, with the closure as it is now."""
        if name in self.inside:
            return CLEAN
        definition = self.local_defs[name]
        saved_env, saved_returned = dict(self.env), self.returned
        params = [a.arg for a in [*definition.args.posonlyargs, *definition.args.args, *definition.args.kwonlyargs]]
        for index, param in enumerate(params):
            self.env[param] = args[index] if index < len(args) else keywords.get(param, CLEAN)
        self.returned = CLEAN
        self.inside.add(name)
        self.block(definition.body)
        self.inside.discard(name)
        returned = self.returned
        self.env, self.returned = saved_env, saved_returned
        return returned


def backend_sources(root: Path = BACKEND) -> dict[str, str]:
    """The backend's modules (not its tests), by module name."""
    found = {}
    for path in sorted(root.rglob("*.py")):
        if path.name.startswith("test_") or path.name == "conftest.py" or "__pycache__" in path.parts:
            continue
        found[path.stem] = path.read_text(encoding="utf-8")
    return found


def find_readers(sources: dict[str, str]) -> dict[str, list[str]]:
    """Every backend function whose own code computes with drawn points, by ``python-backend/module.py:function``
    (the contract table's names), with the decimators they came from: followed through returns, calls, containers
    and stores across modules, not only where a decimator is called."""
    program = Program(sources)
    program.run()
    out: dict[str, list[str]] = {}
    for name, origins in program.readers.items():
        module, function = name.split(":")
        if name in SOURCES:
            continue
        out[f"python-backend/{module}.py:{function.split('.')[-1]}"] = sorted(origins)
    return dict(sorted(out.items()))


def find_flows(sources: dict[str, str]) -> list[Flow]:
    """Every flow of drawn points into a number in ``sources`` (module name → its text)."""
    program = Program(sources)
    missing = [name for name in SOURCES if name.split(":")[0] in sources and name not in program.functions]
    if missing:
        raise SystemExit(f"check_decimation_flow: these thinning functions no longer exist: {', '.join(missing)}")
    return program.run()


def draws_problems(sources: dict[str, str], readers: Iterable[str]) -> list[str]:
    """The backend readers the contract table calls 'draws' (``module:function``) that do more than draw: one
    whose own code makes a number of drawn points, or whose result of drawn points reaches anything but a drawn
    field (DRAWN_KEYS) wherever it goes: another field (a headline, a peak, a range), a reduction, a comparison."""
    named = set(readers)
    program = Program(sources, tagged=named)
    by_last = {name.split(":")[0] + ":" + name.split(":")[1].split(".")[-1]: name for name in program.functions}
    missing = sorted(name for name in named if name not in program.functions and name not in by_last)
    out = [f"python-backend/{name.replace(':', '.py:', 1)}: 'draws', but there is no such function" for name in missing]
    tagged = {by_last.get(name, name) for name in named}
    program.tagged = frozenset(tagged)
    for flow in program.run():
        module, function = flow.where.split(":")
        at = f"python-backend/{module}.py:{flow.line} {function}"
        if flow.where in tagged:
            out.append(f"python-backend/{module}.py:{function.split('.')[-1]}: 'draws', but {flow.what} ({at})")
        for reader in flow.tags:
            if reader == flow.where:
                continue
            mod, func = reader.split(":")
            out.append(
                f"python-backend/{mod}.py:{func.split('.')[-1]}: 'draws', but its result becomes {flow.what} ({at})"
            )
    return sorted(set(out))


def contract_draws(text: str) -> set[str]:
    """The contract table's backend readers classified 'draws' (DRAWN_READERS in values.ts), as ``module:function``."""
    pattern = r"\['python-backend/(\w+)\.py:(\w+)'\]:\s*\{\s*use:\s*'draws'"
    return {f"{module}:{name}" for module, name in re.findall(pattern, text)}


def contract_decimators(text: str) -> set[str]:
    """The contract table's PY_DECIMATORS (values.ts), as ``module:function``."""
    block = re.search(r"export const PY_DECIMATORS[^=]*=\s*\[(.*?)\n\];", text, re.S)
    if block is None:
        raise SystemExit("check_decimation_flow: PY_DECIMATORS not found in values.ts")
    found: set[str] = set()
    pattern = r"\[([^\]]*)\]\.map\(name => `python-backend/(\w+)\.py:\$\{name\}`\)"
    for names, module in re.findall(pattern, block.group(1)):
        found.update(f"{module}:{name}" for name in re.findall(r"'(\w+)'", names))
    return found


def problems(flows: list[Flow], known: dict[str, str] = KNOWN_FLOWS) -> Iterator[str]:
    """What fails: a flow not in ``known``, and a known one no longer found."""
    keys = {flow.key for flow in flows}
    for flow in flows:
        if flow.key not in known:
            module, function = flow.where.split(":")
            via = f" (reached through {' ← '.join(flow.path)})" if flow.path else ""
            yield (
                f"python-backend/{module}.py:{flow.line} {function}: {flow.what} — a number made of points thinned "
                f"to draw by {', '.join(flow.sources)}{via}. Take it from the full data (display rules R1, R2)."
            )
    for key in sorted(set(known) - keys):
        yield f"KNOWN_FLOWS lists a flow no longer found (remove its line; close {known[key]} if fixed): {key}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print every flow found")
    parser.add_argument(
        "--readers", action="store_true", help="print, as JSON, every function computing with drawn points"
    )
    options = parser.parse_args(argv)
    if options.readers:
        print(json.dumps(find_readers(backend_sources())))
        return 0
    listed = contract_decimators(VALUES_TS.read_text(encoding="utf-8"))
    expected = set(SOURCES) - BUCKET_RULE
    if listed != expected:
        print(
            "check_decimation_flow: SOURCES and the contract table's PY_DECIMATORS (values.ts) differ: "
            f"only here {sorted(expected - listed)}, only in values.ts {sorted(listed - expected)}",
            file=sys.stderr,
        )
        return 1
    flows = find_flows(backend_sources())
    misclassified = draws_problems(backend_sources(), contract_draws(VALUES_TS.read_text(encoding="utf-8")))
    for problem in misclassified:
        print(problem, file=sys.stderr)
    if misclassified:
        print(f"check_decimation_flow: {len(misclassified)} 'draws' reader(s) do more than draw", file=sys.stderr)
        return 1
    if options.list:
        for flow in flows:
            print(f"{flow.key}  [{', '.join(flow.sources)}] line {flow.line}  {' ← '.join(flow.path)}")
    found = list(problems(flows))
    for problem in found:
        print(problem, file=sys.stderr)
    if found:
        print(f"check_decimation_flow: {len(found)} problem(s)", file=sys.stderr)
        return 1
    print(f"check_decimation_flow: OK ({len(flows)} known flow(s), each held by a gap)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
