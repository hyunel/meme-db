import asyncio
import hashlib
import json
import logging
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import List
from PIL import Image
from pydantic import AwareDatetime, BaseModel, Field, TypeAdapter
from ..base import Busy, ModelMetric, QuotaMetric
from .base import VLMModel

logger = logging.getLogger(__name__)

QUOTA_REFRESH_SECONDS = 60

# The agent captioning by a prompt: it can only view files, and captions a run's images in one reply
AGENT_SPEC = """\
---
name: {name}
description: Captions meme images for MemeDB.
tools:
  - view_file
mainAgent: true
subagent: false
---

{instructions}

## Workflow

Each request gives a directory and the names of some images in it. Call view_file on all of them at once, in one parallel step, and use no other tool. Then answer with one JSON object and nothing around it, mapping each image's name (without ".png") to its caption object.
"""


class QuotaBucket(BaseModel):
    id: str
    name: str = ''
    window: str = ''
    remaining_fraction: float = Field(ge=0, le=1, allow_inf_nan=False)
    reset_time: AwareDatetime | None = None


class QuotaGroup(BaseModel):
    name: str
    buckets: list[QuotaBucket]


class AgyVLM(VLMModel):
    remote: bool = True

    def _load_model(self) -> None:
        cfg = self.config.vlm.agy
        if not shutil.which(cfg.command):
            raise RuntimeError(f"agy CLI not found: {cfg.command}")
        self.command, self.model_name = cfg.command, cfg.model
        self.name = f"agy {cfg.model}"
        self.batch_size, self.batch_latency, self.concurrency = cfg.batch_size, cfg.batch_latency, cfg.concurrency
        self.workspace = tempfile.TemporaryDirectory(prefix='memedb-agy-')  # Outside any folder whose AGENTS.md agy would load
        self.paused_until = 0.0  # While a quota the model draws on is spent
        self.quota_task: asyncio.Task[list[QuotaGroup]] | None = None
        self.quota_queried_at = 0.0
        self.quota: list[QuotaGroup] | None = None

    async def generate_caption(self, items: List[tuple[Image.Image, str]]) -> List[str | Exception]:
        results: List[str | None] = [None] * len(items)
        error = None
        for prompt in dict.fromkeys(prompt for _, prompt in items):  # One, but at the moment the server's prompt changes
            if time.time() < self.paused_until:
                break
            indices = [i for i, (_, p) in enumerate(items) if p == prompt]
            captions, error = await self._caption([items[i][0] for i in indices], prompt)
            for i, caption in zip(indices, captions):
                results[i] = caption

        if time.time() < self.paused_until:
            failure = Busy(f"agy quota resets at {datetime.fromtimestamp(self.paused_until):%Y-%m-%d %H:%M}")
        else:
            failure = RuntimeError(error or "agy left the image without a caption")
        return [failure if r is None else r for r in results]

    # Captions of the images by an agy run, None where it wrote none, and its error if it failed
    async def _caption(self, images: List[Image.Image], prompt: str) -> tuple[List[str | None], str | None]:
        agent = f"memedb-captioner-{hashlib.sha256(prompt.encode()).hexdigest()[:8]}"
        spec = Path(self.workspace.name, '.agents', 'agents', f'{agent}.md')
        if not spec.exists():
            spec.parent.mkdir(parents=True, exist_ok=True)
            spec.write_text(AGENT_SPEC.format(name=agent, instructions=prompt), encoding='utf-8')

        names = [str(i) for i in range(1, len(images) + 1)]
        with tempfile.TemporaryDirectory(prefix='memedb-agy-run-') as folder:
            for name, image in zip(names, images):
                await asyncio.to_thread(image.save, Path(folder, f'{name}.png'))
            replies, error = await self._run(agent, folder, names)
        if error:
            await self._out_of_quota()
        return [json.dumps(replies[n], ensure_ascii=False) if isinstance(replies.get(n), dict) else None for n in names], error

    # Captions by image name, and the run's error if it failed
    async def _run(self, agent: str, folder: str, names: List[str]) -> tuple[dict, str | None]:
        started = time.time()
        proc = await asyncio.create_subprocess_exec(
            self.command, '--agent', agent, '--model', self.model_name, '--output-format', 'stream-json',
            f'-p=Directory: {folder}\nImages: {" ".join(names)}',
            cwd=self.workspace.name, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            limit=1 << 24,  # A line holds a whole reply
        )
        result, notes, tokens = {}, [], 0
        try:
            async for line in proc.stdout:
                try:
                    event = json.loads(line)
                except ValueError:
                    if note := line.decode(errors='replace').strip():  # stderr, such as an AGY_ERROR line
                        notes.append(note)
                    continue
                if event.get('event') == 'result':
                    result = event['result']
                elif event.get('event') == 'step_update' and (usage := event['step_update'].get('usage')):
                    tokens += usage['input_tokens'] + usage['cache_read_tokens'] + usage['output_tokens']
            await proc.wait()
        finally:
            if proc.returncode is None:  # Its callers left
                proc.terminate()
                await proc.wait()

        reply = result.get('response', '')
        try:
            captions = json.loads(reply[reply.index('{'):reply.rindex('}') + 1])
        except ValueError:
            captions = {}
        captions = {str(name).removesuffix('.png'): c for name, c in captions.items()} if isinstance(captions, dict) else {}
        logger.info(f"agy captioned {sum(n in captions for n in names)}/{len(names)} in {time.time() - started:.0f}s with {tokens} tokens")
        if result.get('status') == 'SUCCESS':
            return captions, None
        return captions, result.get('error') or next(reversed(notes), f"agy exited with {proc.returncode}")

    def metrics(self) -> list[ModelMetric] | None:
        if time.time() - self.quota_queried_at >= QUOTA_REFRESH_SECONDS:
            self._query_quota()
        if self.quota is None:
            return None
        items: list[ModelMetric] = []
        for group in self.quota:
            for bucket in group.buckets:
                name = f'{group.name} · {bucket.window or bucket.name or bucket.id}'
                key = f'{group.name}/{bucket.id}'
                items.append(QuotaMetric(
                    id=key, label_key='quota_remaining', type='quota', group=name,
                    remaining_fraction=bucket.remaining_fraction,
                    resets_at=bucket.reset_time.timestamp() * 1000 if bucket.reset_time else None,
                    level='danger' if bucket.remaining_fraction < 0.01 else 'ok'))
        return items

    def _query_quota(self) -> asyncio.Task[list[QuotaGroup]]:
        task = self.quota_task
        if task is None or task.done():
            task = self.quota_task = asyncio.create_task(self._query_usage())
            self.quota_queried_at = time.time()
            task.add_done_callback(self._keep_quota)
        return task

    def _keep_quota(self, task: asyncio.Task[list[QuotaGroup]]) -> None:
        if not task.cancelled():
            error = task.exception()
            if error:
                logger.warning("Failed to read agy's quota: %r", error)
            else:
                self.quota = task.result()

    async def _query_usage(self) -> list[QuotaGroup]:
        proc = await asyncio.create_subprocess_exec(self.command, '-p=/usage', '--output-format', 'json', cwd=self.workspace.name,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), 60)
            if proc.returncode:
                raise RuntimeError(f'agy quota query exited with {proc.returncode}')
            return TypeAdapter(list[QuotaGroup]).validate_python(json.loads(out)['command']['data']['groups'])
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    async def _out_of_quota(self) -> bool:
        try:
            groups = await asyncio.shield(self._query_quota())
        except Exception:
            return False
        family = self.model_name.split('-')[0]
        buckets = next((g.buckets for g in groups if family in g.name.lower().split()), [])
        if spent := [b for b in buckets if b.remaining_fraction < 0.01 and b.reset_time is not None]:
            self.paused_until = max(self.paused_until, *(b.reset_time.timestamp() for b in spent if b.reset_time is not None))
            logger.warning(f"agy quota spent: captioning paused until {datetime.fromtimestamp(self.paused_until):%Y-%m-%d %H:%M}")
        return bool(spent)
