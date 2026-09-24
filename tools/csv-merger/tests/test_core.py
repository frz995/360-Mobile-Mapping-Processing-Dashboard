import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import core  # noqa: E402


def make_tour_csv(folder: Path, tour: str, date: str, time: str, rows, header=None):
    header = header or ['id', 'lng', 'lat', 'pano']
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{tour}-{date}-{time}.csv"
    body = [[f"{tour}{time}r{i}", '100.1', '5.2', f"{tour}-{date}-{time}-{i}.jpg"] for i in range(rows)]
    core.write_csv(path, header, body)
    return path


def test_sort_copy_flattens_date_subfolders(tmp_path):
    src = tmp_path / 'privacy_keeper'
    make_tour_csv(src / '20220904', '003485', '20220904', '144310', 3)
    make_tour_csv(src / '20220904', '003485', '20220904', '144428', 4)
    out = tmp_path / 'metadata' / 'N93E70'

    result = core.sort_copy(src, out)

    assert len(result['copied']) == 2
    assert sorted(p.name for p in out.iterdir()) == [
        '003485-20220904-144310.csv', '003485-20220904-144428.csv']
    assert (src / '20220904' / '003485-20220904-144310.csv').exists()


def test_sort_copy_renames_duplicate_names(tmp_path):
    src = tmp_path / 'tours'
    make_tour_csv(src, 'A', '20220904', '080000', 1)
    out = tmp_path / 'meta'
    make_tour_csv(out, 'A', '20220904', '080000', 9)

    result = core.sort_copy(src, out)

    assert result['copied'][0]['copied_as'] == 'A-20220904-080000_1.csv'
    assert any('name taken' in w for w in result['warnings'])


def test_merge_groups_by_date_header_once_and_time_order(tmp_path):
    meta = tmp_path / 'N93E70'
    make_tour_csv(meta, '003485', '20220904', '145542', 2)
    make_tour_csv(meta, '003485', '20220904', '144310', 3)
    make_tour_csv(meta, '003486', '20220905', '090000', 4)

    result = core.merge_csvs(meta)

    by_file = {o['file']: o for o in result['outputs']}
    assert set(by_file) == {'20220904.csv', '20220905.csv'}
    assert by_file['20220904.csv']['rows'] == 5
    assert by_file['20220904.csv']['merged_from'] == [
        '003485-20220904-144310.csv', '003485-20220904-145542.csv']
    header, rows = core.read_csv(meta / '20220904.csv')
    assert header == ['id', 'lng', 'lat', 'pano']
    assert len(rows) == 5
    assert (meta / '20220904.csv').read_bytes().startswith(b'\xef\xbb\xbf')


def test_merge_skips_previous_outputs_is_idempotent(tmp_path):
    meta = tmp_path / 'N93E70'
    make_tour_csv(meta, '003485', '20220904', '144310', 3)

    first = core.merge_csvs(meta)
    second = core.merge_csvs(meta)

    assert first['outputs'][0]['rows'] == 3
    assert second['outputs'][0]['rows'] == 3
    assert second['skipped'][0]['reason'] == 'existing merged output'


def test_merge_warns_on_header_mismatch_but_keeps_rows(tmp_path):
    meta = tmp_path / 'G'
    make_tour_csv(meta, 'A', '20220904', '100000', 2)
    make_tour_csv(meta, 'B', '20220904', '110000', 3, header=['id', 'lng', 'lat'])

    result = core.merge_csvs(meta)

    assert result['outputs'][0]['rows'] == 5
    assert any('header differs' in w for w in result['warnings'])


def test_merge_reads_cp1252_files(tmp_path):
    meta = tmp_path / 'G'
    meta.mkdir()
    (meta / 'A-20220904-100000.csv').write_bytes('id,x\r\n1,é\r\n'.encode('cp1252'))

    result = core.merge_csvs(meta)

    assert result['outputs'][0]['rows'] == 1
    header, rows = core.read_csv(meta / '20220904.csv')
    assert rows == [['1', 'é']]


def test_merge_output_name_override_only_for_single_group(tmp_path):
    meta = tmp_path / 'G'
    make_tour_csv(meta, 'A', '20220904', '100000', 2)

    single = core.merge_csvs(meta, output_name='panorama')
    assert single['outputs'][0]['file'] == 'panorama.csv'

    (meta / 'panorama.csv').unlink()
    make_tour_csv(meta, 'B', '20220905', '100000', 2)
    multi = core.merge_csvs(meta, output_name='panorama.csv')
    assert sorted(o['file'] for o in multi['outputs']) == ['20220904.csv', '20220905.csv']


def test_sort_copy_renames_nested_panorama_files_and_skips_tracks(tmp_path):
    src = tmp_path / 'N93E70' / '20220904' / '003485-20220904-144310' / '7'
    src.mkdir(parents=True)
    core.write_csv(src / 'panoramas.csv', ['id'], [['a']])
    core.write_csv(src / 'tracks.csv', ['id'], [['t']])
    (src / 'log.anpp').write_text('x')
    out = tmp_path / 'meta' / 'N93E70'

    result = core.sort_copy(tmp_path / 'N93E70', out)

    assert [c['copied_as'] for c in result['copied']] == ['003485-20220904-144310.csv']
    assert not (out / 'tracks.csv').exists()
    assert len(core.collect_csvs(out)) == 1


def test_merge_date_falls_back_to_parent_folder(tmp_path):
    day = tmp_path / '20220904'
    day.mkdir()
    core.write_csv(day / 'panorama-a.csv', ['id'], [['a'], ['b']])
    core.write_csv(day / 'panorama-b.csv', ['id'], [['c']])

    result = core.merge_csvs(day)

    assert result['outputs'][0]['file'] == '20220904.csv'
    assert result['outputs'][0]['rows'] == 3


def test_master_merge_rolls_up_child_date_files_named_after_subgrid(tmp_path):
    sub = tmp_path / 'N93E70'
    sub.mkdir()
    core.write_csv(sub / '20220904.csv', ['id', 'x'], [['a', '1'], ['b', '2']])
    core.write_csv(sub / '20220905.csv', ['id', 'x'], [['c', '3']])
    make_tour_csv(sub, '003485', '20220906', '100000', 2)

    first = core.master_merge(sub)

    out = first['outputs'][0]
    assert out['file'] == 'N93E70.csv'
    assert out['rows'] == 3
    assert out['merged_from'] == ['20220904.csv', '20220905.csv']
    assert first['ignored'] == 1

    second = core.master_merge(sub)
    assert second['outputs'][0]['rows'] == 3
    header, rows = core.read_csv(sub / 'N93E70.csv')
    assert header == ['id', 'x']
    assert rows == [['a', '1'], ['b', '2'], ['c', '3']]


def test_master_merge_output_name_override_and_collision_guard(tmp_path):
    sub = tmp_path / 'N93E70'
    sub.mkdir()
    core.write_csv(sub / '20220904.csv', ['id'], [['a']])

    custom = core.master_merge(sub, output_name='panorama.csv')
    assert custom['outputs'][0]['file'] == 'panorama.csv'

    clash = core.master_merge(sub, output_name='20220904')
    assert clash['outputs'] == []
    assert any('matches an existing child' in w for w in clash['warnings'])


def test_master_merge_warns_on_header_mismatch(tmp_path):
    sub = tmp_path / 'SUB'
    sub.mkdir()
    core.write_csv(sub / '20220904.csv', ['id', 'x'], [['a', '1']])
    core.write_csv(sub / '20220905.csv', ['id'], [['b']])

    result = core.master_merge(sub)

    assert result['outputs'][0]['rows'] == 2
    assert any('20220905.csv' in w and 'header differs' in w for w in result['warnings'])


def test_master_merge_without_children_reports_warning(tmp_path):
    sub = tmp_path / 'SUB'
    make_tour_csv(sub, '003485', '20220904', '100000', 2)

    result = core.master_merge(sub)

    assert result['outputs'] == []
    assert any('run merge metadata first' in w.lower() for w in result['warnings'])
